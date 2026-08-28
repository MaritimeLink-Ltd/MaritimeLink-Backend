import type { Server as SocketServer } from 'socket.io';
import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';
import { ActorType } from '../generated/client/index.js';
import { logActivity } from '../services/activityLogger.js';
import { getClientIp } from '../utils/requestMetadata.js';
import { notifyAnnouncement } from '../services/eventNotificationService.js';
import { sendAnnouncementSchema } from '../validations/announcementValidation.js';

/** Keeps sends bounded rather than firing hundreds of emails at once. */
const SEND_CONCURRENCY = 5;

const inChunks = async <T>(
  items: T[],
  size: number,
  run: (item: T) => Promise<void>,
) => {
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    await Promise.all(chunk.map(run));
  }
};

/**
 * Sends the announcement to every recipient after the HTTP response has
 * already gone out — a list of any real size must not hold the admin's
 * request open, and there is no job queue in this codebase to hand it off to.
 * Failures are per-recipient and non-fatal; the final tally is written to the
 * activity log so an admin can confirm what actually went out.
 */
async function sendAnnouncementInBackground(params: {
  subject: string;
  message: string;
  professionalIds: string[];
  recruiterIds: string[];
  io?: SocketServer;
  adminId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const {
    subject,
    message,
    professionalIds,
    recruiterIds,
    io,
    adminId,
    ipAddress,
    userAgent,
  } = params;

  let sent = 0;
  let failed = 0;

  const sendOne =
    (audience: 'PROFESSIONAL' | 'RECRUITER', userId: string) => async () => {
      try {
        await notifyAnnouncement({ audience, userId, subject, message, io });
        sent += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `[announcements] Failed to send to ${audience} ${userId}:`,
          error,
        );
      }
    };

  await inChunks(professionalIds, SEND_CONCURRENCY, (id) =>
    sendOne('PROFESSIONAL', id)(),
  );
  await inChunks(recruiterIds, SEND_CONCURRENCY, (id) =>
    sendOne('RECRUITER', id)(),
  );

  await logActivity({
    action: 'ANNOUNCEMENT_SENT',
    actorId: adminId,
    actorType: ActorType.ADMIN,
    targetType: 'Announcement',
    ipAddress,
    userAgent,
    metadata: {
      subject,
      totalRecipients: professionalIds.length + recruiterIds.length,
      professionals: professionalIds.length,
      recruiters: recruiterIds.length,
      sent,
      failed,
    },
  });

  console.log(
    `[announcements] "${subject}" — sent ${sent}, failed ${failed} of ${professionalIds.length + recruiterIds.length}`,
  );
}

/**
 * Admin bulk announcement — marketing emails, greetings, general notices —
 * to any mix of professionals, recruiters and training providers, verified
 * or pending. This is additive to (and independent of) the existing
 * PENDING-only "request profile completion" feature, which is untouched.
 */
export const sendAnnouncement = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const { subject, message, professionalIds, recruiterIds } =
      sendAnnouncementSchema.parse(req.body);

    const [professionals, recruiters] = await Promise.all([
      professionalIds.length
        ? prisma.professional.findMany({
            where: { id: { in: professionalIds } },
            select: { id: true },
          })
        : Promise.resolve([]),
      recruiterIds.length
        ? prisma.recruiter.findMany({
            where: { id: { in: recruiterIds } },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);

    const totalRecipients = professionals.length + recruiters.length;
    const io = req.app.get('io');

    // Respond first — see sendAnnouncementInBackground for why.
    res.status(200).json({
      status: 'success',
      message: `Announcement is being sent to ${totalRecipients} recipient(s)`,
      data: {
        totalRecipients,
        professionals: professionals.length,
        recruiters: recruiters.length,
      },
    });

    void sendAnnouncementInBackground({
      subject,
      message,
      professionalIds: professionals.map((p) => p.id),
      recruiterIds: recruiters.map((r) => r.id),
      io,
      adminId: req.user!.id,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
  },
);
