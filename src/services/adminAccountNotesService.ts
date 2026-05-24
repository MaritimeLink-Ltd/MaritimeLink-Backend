import { Prisma } from '../generated/client/index.js';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';

export const kycNotesInclude = {
  notes: {
    include: { admin: { select: { id: true, email: true } } },
    orderBy: { createdAt: 'desc' as Prisma.SortOrder },
  },
} satisfies Prisma.RecruiterKycInclude;

export const professionalKycNotesInclude = {
  notes: {
    include: { admin: { select: { id: true, email: true } } },
    orderBy: { createdAt: 'desc' as Prisma.SortOrder },
  },
} satisfies Prisma.ProfessionalKycInclude;

export const createRecruiterAccountNote = async (
  recruiterId: string,
  adminId: string,
  content: string,
) => {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new AppError('Note content is required', 400);
  }

  const kyc = await prisma.recruiterKyc.findUnique({
    where: { recruiterId },
    select: { id: true },
  });

  if (!kyc) {
    throw new AppError(
      'This account does not have a KYC record yet. Open the KYC submission to add notes.',
      404,
    );
  }

  return prisma.kycNote.create({
    data: {
      content: trimmed,
      adminId,
      recruiterKycId: kyc.id,
    },
    include: { admin: { select: { id: true, email: true } } },
  });
};

export const createProfessionalAccountNote = async (
  professionalId: string,
  adminId: string,
  content: string,
) => {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new AppError('Note content is required', 400);
  }

  const kyc = await prisma.professionalKyc.findUnique({
    where: { professionalId },
    select: { id: true },
  });

  if (!kyc) {
    throw new AppError(
      'This account does not have a KYC record yet. Open the KYC submission to add notes.',
      404,
    );
  }

  return prisma.kycNote.create({
    data: {
      content: trimmed,
      adminId,
      professionalKycId: kyc.id,
    },
    include: { admin: { select: { id: true, email: true } } },
  });
};
