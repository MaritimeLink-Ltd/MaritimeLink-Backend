import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import { KycRiskLevel } from '../generated/client/index.js';

type ProfessionalDetailRecord = {
  riskLevel?: KycRiskLevel | null;
  hasCompanyMismatch?: boolean | null;
  kyc?: {
    riskLevel?: KycRiskLevel | null;
    hasCompanyMismatch?: boolean | null;
  } | null;
};

const resolveRecruiterRiskLevel = (recruiter: {
  organizationRiskLevel?: KycRiskLevel | null;
  kyc: { riskLevel: KycRiskLevel } | null;
}) =>
  recruiter.kyc?.riskLevel === KycRiskLevel.HIGH ||
  recruiter.organizationRiskLevel === KycRiskLevel.HIGH
    ? KycRiskLevel.HIGH
    : (recruiter.kyc?.riskLevel ??
      recruiter.organizationRiskLevel ??
      KycRiskLevel.LOW);

const resolveRecruiterMismatch = (recruiter: {
  organizationVerified?: boolean | null;
  kyc: { mismatchDetected: boolean } | null;
}) =>
  Boolean(recruiter.kyc?.mismatchDetected) ||
  recruiter.organizationVerified === false;

const buildProfessional = async (id: string) => {
  const professional = await prisma.professional.findUnique({
    where: { id },
    include: {
      kyc: {
        include: {
          notes: {
            include: { admin: { select: { id: true, email: true } } },
            orderBy: { createdAt: 'desc' },
          },
        },
      },
      resume: {
        include: {
          skills: true,
          licenses: true,
          seaService: true,
          education: true,
          stcwCertificates: true,
          medicalCertificates: true,
          travelDocuments: true,
          nextOfKin: true,
          referees: true,
        },
      },
      documents: {
        orderBy: { createdAt: 'desc' },
      },
      bookings: {
        include: {
          course: true,
          sessions: true,
          attachedDocuments: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      savedJobs: {
        include: { job: true },
        orderBy: { createdAt: 'desc' },
      },
      savedCourses: {
        include: { course: true },
        orderBy: { createdAt: 'desc' },
      },
      applications: {
        include: {
          job: true,
          attachedDocuments: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      alerts: {
        orderBy: { createdAt: 'desc' },
      },
      invitations: {
        include: { job: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!professional) return null;
  const professionalRecord = professional as typeof professional &
    ProfessionalDetailRecord;

  return {
    accountType: 'PROFESSIONAL',
    professional: {
      ...professional,
      riskLevel:
        professionalRecord.kyc?.riskLevel ??
        professionalRecord.riskLevel ??
        null,
      hasCompanyMismatch: Boolean(
        professionalRecord.hasCompanyMismatch ??
        professionalRecord.kyc?.hasCompanyMismatch,
      ),
    },
  };
};

const buildRecruiter = async (id: string) => {
  const recruiter = await prisma.recruiter.findFirst({
    where: { id, role: 'RECRUITMENT_AGENT' },
    include: {
      kyc: true,
      jobs: true,
    },
  });

  if (!recruiter) return null;

  return {
    accountType: 'RECRUITMENT_AGENT',
    recruiter: {
      ...recruiter,
      riskLevel: resolveRecruiterRiskLevel(recruiter),
      hasCompanyMismatch: resolveRecruiterMismatch(recruiter),
    },
  };
};

const buildTrainer = async (id: string) => {
  const trainer = await prisma.recruiter.findFirst({
    where: { id, role: 'TRAINING_AGENT' },
    include: {
      kyc: true,
      courses: true,
    },
  });

  if (!trainer) return null;

  return {
    accountType: 'TRAINING_AGENT',
    trainer: {
      ...trainer,
      riskLevel: resolveRecruiterRiskLevel(trainer),
      hasCompanyMismatch: resolveRecruiterMismatch(trainer),
    },
  };
};

function normalizeAccountTypeHint(value?: string | null) {
  if (!value) return '';
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export const getAccountById = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const hint = normalizeAccountTypeHint(
      (req.query.accountType as string) ||
        (req.query.userType as string) ||
        null,
    );

    const attempts: Array<() => Promise<Record<string, unknown> | null>> = [];

    if (hint === 'professional') attempts.push(() => buildProfessional(id));
    else if (hint === 'trainer' || hint === 'training_agent')
      attempts.push(() => buildTrainer(id));
    else if (hint === 'recruiter' || hint === 'recruitment_agent')
      attempts.push(() => buildRecruiter(id));
    else
      attempts.push(
        () => buildProfessional(id),
        () => buildTrainer(id),
        () => buildRecruiter(id),
      );

    let payload: Record<string, unknown> | null = null;
    for (const attempt of attempts) {
      payload = await attempt();
      if (payload) break;
    }

    if (!payload) {
      return next(new AppError('Account not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: payload,
    });
  },
);
