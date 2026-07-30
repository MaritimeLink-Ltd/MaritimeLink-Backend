import type { Server as SocketServer } from 'socket.io';
import { prisma } from '../config/prisma.js';
import {
  DocumentCategory,
  ProfessionalStatus,
} from '../generated/client/index.js';
import {
  EXPIRED_STAGE,
  EXPIRY_LOOKAHEAD_DAYS,
  MS_PER_DAY,
  daysUntil,
  formatExpiryDate,
  resolveReminderStage,
} from '../utils/documentExpiry.js';
import type { DocumentExpiryDigestItem } from './emailService.js';
import { notifyDocumentExpiry } from './eventNotificationService.js';

/** Accounts that should not receive reminder mail. */
const UNREACHABLE_STATUSES: ProfessionalStatus[] = [
  ProfessionalStatus.SUSPENDED,
  ProfessionalStatus.BLOCKED,
];

/** Resume/cover-letter rows live in the same table but are not wallet certificates. */
const NON_CERTIFICATE_CATEGORIES: DocumentCategory[] = [
  DocumentCategory.CV_RESUME,
  DocumentCategory.COVER_LETTER,
];

export type ExpiryReminderRunResult = {
  documentsScanned: number;
  professionalsNotified: number;
  documentsReminded: number;
  emailsFailed: number;
  dryRun: boolean;
};

export type ExpiryReminderRunOptions = {
  /** Log what would be sent without emailing or writing reminder state. */
  dryRun?: boolean;
  /** Restrict the run to a single professional's email — for safe live testing. */
  onlyEmail?: string;
  /** Overridable for tests. */
  now?: Date;
  io?: SocketServer;
};

/**
 * Scans every document expiring within the lookahead window (plus those already
 * expired), groups the ones that crossed a new milestone by professional, and
 * sends one digest each.
 *
 * Safe to run more than once a day: reminder state is only written after the
 * email is delivered, so a repeat run sends nothing and a failed run retries.
 */
export async function runDocumentExpiryReminders(
  options: ExpiryReminderRunOptions = {},
): Promise<ExpiryReminderRunResult> {
  const { dryRun = false, onlyEmail, io } = options;
  const now = options.now ?? new Date();

  const horizon = new Date(now.getTime() + EXPIRY_LOOKAHEAD_DAYS * MS_PER_DAY);

  const documents = await prisma.professionalDocument.findMany({
    where: {
      expiryDate: { not: null, lte: horizon },
      category: { notIn: NON_CERTIFICATE_CATEGORIES },
      professional: {
        status: { notIn: UNREACHABLE_STATUSES },
        ...(onlyEmail ? { email: onlyEmail } : {}),
      },
    },
    select: {
      id: true,
      name: true,
      expiryDate: true,
      lastExpiryReminderStage: true,
      professionalId: true,
      professional: {
        select: {
          id: true,
          email: true,
          fullname: true,
          firstName: true,
          lastName: true,
        },
      },
    },
    orderBy: { expiryDate: 'asc' },
  });

  type PendingDoc = {
    id: string;
    stage: string;
    item: DocumentExpiryDigestItem;
  };

  type PendingGroup = {
    professionalId: string;
    email: string;
    recipientName: string;
    expired: PendingDoc[];
    expiring: PendingDoc[];
  };

  const groups = new Map<string, PendingGroup>();

  for (const doc of documents) {
    if (!doc.expiryDate) continue;

    const email = doc.professional?.email;
    if (!email) continue;

    const stage = resolveReminderStage(doc.expiryDate, now);
    if (!stage) continue;

    // Already emailed for this milestone — nothing new to say today.
    if (stage === doc.lastExpiryReminderStage) continue;

    const days = daysUntil(doc.expiryDate, now);
    const pending: PendingDoc = {
      id: doc.id,
      stage,
      item: {
        documentName: doc.name,
        expiryDate: formatExpiryDate(doc.expiryDate),
        daysRemaining: days,
      },
    };

    let group = groups.get(doc.professionalId);
    if (!group) {
      group = {
        professionalId: doc.professionalId,
        email,
        recipientName:
          doc.professional?.fullname?.trim() ||
          [doc.professional?.firstName, doc.professional?.lastName]
            .filter(Boolean)
            .join(' ') ||
          'there',
        expired: [],
        expiring: [],
      };
      groups.set(doc.professionalId, group);
    }

    if (stage === EXPIRED_STAGE) group.expired.push(pending);
    else group.expiring.push(pending);
  }

  const result: ExpiryReminderRunResult = {
    documentsScanned: documents.length,
    professionalsNotified: 0,
    documentsReminded: 0,
    emailsFailed: 0,
    dryRun,
  };

  for (const group of groups.values()) {
    const all = [...group.expired, ...group.expiring];
    if (all.length === 0) continue;

    if (dryRun) {
      console.log(
        `[expiry-reminders] would email ${group.email}: ${group.expired.length} expired, ${group.expiring.length} expiring`,
      );
      result.professionalsNotified += 1;
      result.documentsReminded += all.length;
      continue;
    }

    try {
      await notifyDocumentExpiry({
        professionalId: group.professionalId,
        email: group.email,
        recipientName: group.recipientName,
        expired: group.expired.map((d) => d.item),
        expiring: group.expiring.map((d) => d.item),
        io,
      });
    } catch (error) {
      // Reminder state is left untouched so the next run retries this digest.
      console.error(
        `[expiry-reminders] failed for professional ${group.professionalId}`,
        error,
      );
      result.emailsFailed += 1;
      continue;
    }

    // Written only after a successful send, keeping the job idempotent.
    const byStage = new Map<string, string[]>();
    for (const doc of all) {
      const ids = byStage.get(doc.stage) ?? [];
      ids.push(doc.id);
      byStage.set(doc.stage, ids);
    }

    await prisma.$transaction(
      [...byStage.entries()].map(([stage, ids]) =>
        prisma.professionalDocument.updateMany({
          where: { id: { in: ids } },
          data: { lastExpiryReminderStage: stage, lastExpiryReminderAt: now },
        }),
      ),
    );

    result.professionalsNotified += 1;
    result.documentsReminded += all.length;
  }

  return result;
}
