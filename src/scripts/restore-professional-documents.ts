import { readFileSync } from 'fs';
import { prisma } from '../config/prisma.js';
import {
  DocumentCategory,
  OCRStatus,
  VerificationStatus,
} from '../generated/client/index.js';

/**
 * One-time restore: reinserts the ProfessionalDocument rows for kept
 * professionals that were deleted by reset-database-keep-accounts.ts before
 * we realized "document wallet" should be preserved for those accounts.
 * Source: pg_dump backup taken immediately before that reset.
 */

const BLOCK_FILE = process.argv[2];
if (!BLOCK_FILE) {
  console.error(
    'Usage: tsx restore-professional-documents.ts <extracted-copy-block.txt>',
  );
  process.exit(1);
}

const nullable = (v: string) => (v === '\\N' ? null : v);

async function main() {
  const lines = readFileSync(BLOCK_FILE, 'utf8')
    .split('\n')
    .filter(
      (l) =>
        l.trim() &&
        l !== 'COPY public.professional_documents' &&
        !l.startsWith('COPY ') &&
        l !== '\\.',
    );

  console.log(`[restore] parsing ${lines.length} row(s) from ${BLOCK_FILE}`);

  const rows = lines.map((line) => {
    const cols = line.split('\t');
    const [
      id,
      professionalId,
      category,
      name,
      number,
      issuingCountry,
      issueDate,
      expiryDate,
      fileUrl,
      createdAt,
      updatedAt,
      mimeType,
      ocrData,
      ocrStatus,
      verificationStatus,
      lastExpiryReminderAt,
      lastExpiryReminderStage,
    ] = cols;

    return {
      id,
      professionalId,
      category: category as DocumentCategory,
      name,
      number: nullable(number),
      issuingCountry: nullable(issuingCountry),
      issueDate: nullable(issueDate) ? new Date(issueDate) : null,
      expiryDate: nullable(expiryDate) ? new Date(expiryDate) : null,
      fileUrl,
      createdAt: new Date(createdAt),
      updatedAt: new Date(updatedAt),
      mimeType: nullable(mimeType),
      ocrData: nullable(ocrData) ? JSON.parse(ocrData) : undefined,
      ocrStatus: ocrStatus as OCRStatus,
      verificationStatus: verificationStatus as VerificationStatus,
      lastExpiryReminderAt: nullable(lastExpiryReminderAt)
        ? new Date(lastExpiryReminderAt)
        : null,
      lastExpiryReminderStage: nullable(lastExpiryReminderStage),
    };
  });

  for (const row of rows) {
    console.log(
      `  restoring ${row.id} (${row.category}) for professional ${row.professionalId}`,
    );
  }

  const result = await prisma.professionalDocument.createMany({
    data: rows,
    skipDuplicates: true,
  });
  console.log(`[restore] inserted ${result.count} row(s)`);
}

main()
  .catch((err) => {
    console.error('[restore] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
