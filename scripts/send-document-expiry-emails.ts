/**
 * Run daily (cron): notify professionals about documents expiring within 30 days or already expired.
 * Example: npx tsx scripts/send-document-expiry-emails.ts
 */
import { prisma } from '../src/config/prisma.js';
import { sendDocumentExpiryEmail } from '../src/services/emailService.js';
import { appUrl } from '../src/services/emailLayout.js';
import { displayName } from '../src/services/eventNotificationService.js';

const EXPIRING_WITHIN_DAYS = 30;

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

async function main() {
  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + EXPIRING_WITHIN_DAYS);

  const documents = await prisma.professionalDocument.findMany({
    where: {
      expiryDate: { not: null, lte: horizon },
      category: { notIn: ['CV_RESUME', 'COVER_LETTER'] },
    },
    select: {
      id: true,
      name: true,
      expiryDate: true,
      professional: {
        select: {
          email: true,
          fullname: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  let sent = 0;
  for (const doc of documents) {
    if (!doc.expiryDate || !doc.professional.email) continue;
    const expired = doc.expiryDate < now;
    try {
      await sendDocumentExpiryEmail({
        to: doc.professional.email,
        recipientName: displayName(doc.professional),
        documentName: doc.name,
        expiryDate: formatDate(doc.expiryDate),
        expired,
        dashboardUrl: appUrl('/personal/documents'),
      });
      sent += 1;
    } catch (error) {
      console.error(`Failed for document ${doc.id}:`, error);
    }
  }

  console.log(`Document expiry emails sent: ${sent} / ${documents.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
