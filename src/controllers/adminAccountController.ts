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
  const [trainer, bookingAgg] = await Promise.all([
    prisma.recruiter.findFirst({
      where: { id, role: 'TRAINING_AGENT' },
      include: {
        kyc: true,
        courses: true,
      },
    }),
    prisma.courseBooking.aggregate({
      where: {
        paymentStatus: 'SUCCEEDED',
        course: { recruiterId: id },
      },
      _count: { id: true },
      _sum: {
        amountPaid: true,
        trainerPayout: true,
      },
    }),
  ]);

  if (!trainer) return null;

  return {
    accountType: 'TRAINING_AGENT',
    trainer: {
      ...trainer,
      riskLevel: resolveRecruiterRiskLevel(trainer),
      hasCompanyMismatch: resolveRecruiterMismatch(trainer),
      traineesCount: Number(bookingAgg?._count?.id || 0),
      grossRevenue: Number(bookingAgg?._sum?.amountPaid || 0),
      payoutRevenue: Number(bookingAgg?._sum?.trainerPayout || 0),
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

export const getRejectedAccounts = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const [recruiters, professionals] = await Promise.all([
      prisma.recruiter.findMany({
        where: { status: 'REJECTED' },
        select: {
          id: true,
          email: true,
          role: true,
          organizationName: true,
          firstName: true,
          lastName: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.professional.findMany({
        where: {
          kyc: { status: 'REJECTED' },
        },
        select: {
          id: true,
          email: true,
          fullname: true,
          firstName: true,
          lastName: true,
          updatedAt: true,
          kyc: { select: { updatedAt: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const accounts = [
      ...recruiters.map((recruiter) => {
        const name =
          recruiter.organizationName ||
          [recruiter.firstName, recruiter.lastName].filter(Boolean).join(' ') ||
          'Unknown';
        const isTrainer = recruiter.role === 'TRAINING_AGENT';
        return {
          id: recruiter.id,
          accountName: name,
          accountType: isTrainer ? 'Training Provider' : 'Recruiter',
          accountKind: isTrainer ? 'trainer' : 'recruiter',
          email: recruiter.email,
          issueType: 'Account Rejected',
          issueDescription:
            'This account was rejected by an admin during review.',
          severity: 'CRITICAL',
          status: 'Rejected',
          rejectedAt: recruiter.updatedAt.toISOString(),
        };
      }),
      ...professionals.map((professional) => {
        const name =
          professional.fullname ||
          [professional.firstName, professional.lastName]
            .filter(Boolean)
            .join(' ') ||
          'Unknown';
        return {
          id: professional.id,
          accountName: name,
          accountType: 'Professional',
          accountKind: 'professional',
          email: professional.email,
          issueType: 'Account Rejected',
          issueDescription:
            'KYC verification was rejected by an admin during review.',
          severity: 'CRITICAL',
          status: 'Rejected',
          rejectedAt: (
            professional.kyc?.updatedAt || professional.updatedAt
          ).toISOString(),
        };
      }),
    ].sort(
      (a, b) =>
        new Date(b.rejectedAt).getTime() - new Date(a.rejectedAt).getTime(),
    );

    res.status(200).json({
      status: 'success',
      results: accounts.length,
      data: { accounts },
    });
  },
);

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
