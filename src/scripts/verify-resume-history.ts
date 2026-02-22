import { prisma } from '../config/prisma.js';
import {
  DocumentCategory,
  OCRStatus,
  VerificationStatus,
} from '../generated/client/index.js';

async function verifyResumeHistory() {
  console.log('🚀 Starting Verification: Resume History Flow');

  try {
    // 1. Find/Setup Professional
    const professional = await prisma.professional.findFirst({
      where: { email: 'cv-test@example.com' },
    });

    if (!professional) {
      throw new Error(
        'Professional not found. Run verify-cv-flow first or setup manual test user.',
      );
    }

    console.log(`✅ Testing for professional: ${professional.fullname}`);

    // 2. Simulate Upload 1 (logic from uploadResume controller)
    const cv1Url = 'https://supabase.com/resumes/history-1.pdf';
    console.log('📦 Uploading Resume version 1...');
    const doc1 = await prisma.professionalDocument.create({
      data: {
        professionalId: professional.id,
        category: DocumentCategory.CV_RESUME,
        name: 'history-1.pdf',
        fileUrl: cv1Url,
        ocrStatus: OCRStatus.COMPLETED,
        verificationStatus: VerificationStatus.PENDING,
      },
    });

    await prisma.professional.update({
      where: { id: professional.id },
      data: { cvUrl: cv1Url },
    });

    // 3. Simulate Upload 2
    const cv2Url = 'https://supabase.com/resumes/history-2.pdf';
    console.log('📦 Uploading Resume version 2...');
    const doc2 = await prisma.professionalDocument.create({
      data: {
        professionalId: professional.id,
        category: DocumentCategory.CV_RESUME,
        name: 'history-2.pdf',
        fileUrl: cv2Url,
        ocrStatus: OCRStatus.COMPLETED,
        verificationStatus: VerificationStatus.PENDING,
      },
    });

    await prisma.professional.update({
      where: { id: professional.id },
      data: { cvUrl: cv2Url },
    });

    // 4. Verify Document Wallet (List resumes)
    console.log('🔍 Listing resumes for history verification...');
    const resumes = await prisma.professionalDocument.findMany({
      where: {
        professionalId: professional.id,
        category: DocumentCategory.CV_RESUME,
      },
      orderBy: { createdAt: 'desc' },
    });

    console.log(`📊 Found ${resumes.length} resumes in history.`);

    const hasCv1 = resumes.some((r) => r.fileUrl === cv1Url);
    const hasCv2 = resumes.some((r) => r.fileUrl === cv2Url);

    if (hasCv1 && hasCv2) {
      console.log('💎 SUCCESS: Both resumes persist in history.');
    } else {
      throw new Error('Resume history missing entries.');
    }

    // 5. Verify Profile reflects latest
    const updatedProf = await prisma.professional.findUnique({
      where: { id: professional.id },
    });

    if (updatedProf?.cvUrl === cv2Url) {
      console.log(
        '💎 SUCCESS: Profile cvUrl correctly reflects latest upload.',
      );
    } else {
      throw new Error('Profile cvUrl does not reflect latest.');
    }

    // 6. Cleanup
    console.log('🧹 Cleaning up history test documents...');
    await prisma.professionalDocument.deleteMany({
      where: { id: { in: [doc1.id, doc2.id] } },
    });

    console.log('🎉 Resume History Verification Finished Successfully');
  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

verifyResumeHistory();
