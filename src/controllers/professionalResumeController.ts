import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { resumeSchema } from '../validations/resumeValidation.js';
import { CustomRequest } from '../types/index.js';

export const upsertResume = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;

    if (!professionalId) {
      return next(new AppError('Unauthorized', 401));
    }

    const validatedData = resumeSchema.parse(req.body);

    const {
      skills,
      licenses,
      seaService,
      education,
      stcwCertificates,
      medicalCertificates,
      travelDocuments,
      nextOfKin,
      referees,
      ...mainResumeData
    } = validatedData;

    // We use a transaction to ensure atomic updates
    const updatedResume = await prisma.$transaction(async (tx) => {
      // 1. Upsert the main resume record
      const resume = await tx.professionalResume.upsert({
        where: { professionalId },
        create: {
          ...mainResumeData,
          professionalId,
        },
        update: {
          ...mainResumeData,
        },
      });

      // 2. Clear out existing list-based sub-resources and recreate them
      // This is simpler than matching IDs for nested updates
      await tx.professionalSkill.deleteMany({ where: { resumeId: resume.id } });
      await tx.professionalLicense.deleteMany({
        where: { resumeId: resume.id },
      });
      await tx.professionalSeaServiceLog.deleteMany({
        where: { resumeId: resume.id },
      });
      await tx.professionalEducation.deleteMany({
        where: { resumeId: resume.id },
      });
      await tx.professionalSTCWCertificate.deleteMany({
        where: { resumeId: resume.id },
      });
      await tx.professionalMedicalCertificate.deleteMany({
        where: { resumeId: resume.id },
      });
      await tx.professionalTravelDocument.deleteMany({
        where: { resumeId: resume.id },
      });
      await tx.professionalNextOfKin.deleteMany({
        where: { resumeId: resume.id },
      });
      await tx.professionalReferee.deleteMany({
        where: { resumeId: resume.id },
      });

      // 3. Create new records for everything that was provided
      if (skills?.length) {
        await tx.professionalSkill.createMany({
          data: skills.map((s) => ({ ...s, resumeId: resume.id })),
        });
      }
      if (licenses?.length) {
        await tx.professionalLicense.createMany({
          data: licenses.map((l) => ({ ...l, resumeId: resume.id })),
        });
      }
      if (seaService?.length) {
        await tx.professionalSeaServiceLog.createMany({
          data: seaService.map((s) => ({ ...s, resumeId: resume.id })),
        });
      }
      if (education?.length) {
        await tx.professionalEducation.createMany({
          data: education.map((e) => ({ ...e, resumeId: resume.id })),
        });
      }
      if (stcwCertificates?.length) {
        await tx.professionalSTCWCertificate.createMany({
          data: stcwCertificates.map((s) => ({ ...s, resumeId: resume.id })),
        });
      }
      if (medicalCertificates?.length) {
        await tx.professionalMedicalCertificate.createMany({
          data: medicalCertificates.map((m) => ({ ...m, resumeId: resume.id })),
        });
      }
      if (travelDocuments?.length) {
        await tx.professionalTravelDocument.createMany({
          data: travelDocuments.map((t) => ({ ...t, resumeId: resume.id })),
        });
      }
      if (nextOfKin?.length) {
        await tx.professionalNextOfKin.createMany({
          data: nextOfKin.map((n) => ({ ...n, resumeId: resume.id })),
        });
      }
      if (referees?.length) {
        await tx.professionalReferee.createMany({
          data: referees.map((r) => ({ ...r, resumeId: resume.id })),
        });
      }

      return resume;
    });

    res.status(200).json({
      status: 'success',
      message: 'Resume updated successfully',
      data: { resumeId: updatedResume.id },
    });
  },
);

export const getResume = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;

    if (!professionalId) {
      return next(new AppError('Unauthorized', 401));
    }

    const resume = await prisma.professionalResume.findUnique({
      where: { professionalId },
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
    });

    if (!resume) {
      return next(new AppError('Resume not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { resume },
    });
  },
);
