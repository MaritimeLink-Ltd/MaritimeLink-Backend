import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import {
  resumeSchema,
  personalInfoStepSchema,
  summaryStepSchema,
  skillStepSchema,
  licenseStepSchema,
  seaServiceStepSchema,
  educationStepSchema,
  stcwCertificateStepSchema,
  medicalTravelStepSchema,
  biometricsStepSchema,
  nextOfKinStepSchema,
  refereeStepSchema,
} from '../validations/resumeValidation.js';
import { CustomRequest } from '../types/index.js';

/**
 * Step 6: Personal Information
 */
export const updatePersonalInfo = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    if (!professionalId) return next(new AppError('Unauthorized', 401));

    const validatedData = personalInfoStepSchema.parse(req.body);
    const { firstName, lastName, middleName, ...resumeData } = validatedData;

    await prisma.$transaction([
      prisma.professional.update({
        where: { id: professionalId },
        data: { firstName, lastName, middleName },
      }),
      prisma.professionalResume.upsert({
        where: { professionalId },
        create: { ...resumeData, professionalId },
        update: resumeData,
      }),
    ]);

    res
      .status(200)
      .json({ status: 'success', message: 'Personal info updated' });
  },
);

/**
 * Step 7: Professional Summary
 */
export const updateSummary = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    if (!professionalId) return next(new AppError('Unauthorized', 401));

    const { summary } = summaryStepSchema.parse(req.body);

    await prisma.professionalResume.upsert({
      where: { professionalId },
      create: { summary, professionalId },
      update: { summary },
    });

    res.status(200).json({ status: 'success', message: 'Summary updated' });
  },
);

/**
 * Step 8: Key Skills
 */
export const addSkill = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    if (!professionalId) return next(new AppError('Unauthorized', 401));

    const validatedData = skillStepSchema.parse(req.body);

    const resume = await prisma.professionalResume.findUnique({
      where: { professionalId },
    });
    if (!resume) return next(new AppError('Resume not found', 404));

    await prisma.professionalSkill.create({
      data: { ...validatedData, resumeId: resume.id },
    });

    res.status(201).json({ status: 'success', message: 'Skill added' });
  },
);

/**
 * Step 9: Licenses & Endorsements
 */
export const addLicense = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    if (!professionalId) return next(new AppError('Unauthorized', 401));

    const validatedData = licenseStepSchema.parse(req.body);

    const resume = await prisma.professionalResume.findUnique({
      where: { professionalId },
    });
    if (!resume) return next(new AppError('Resume not found', 404));

    await prisma.professionalLicense.create({
      data: { ...validatedData, resumeId: resume.id },
    });

    res.status(201).json({ status: 'success', message: 'License added' });
  },
);

/**
 * Step 10: Sea Service Log
 */
export const addSeaService = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    if (!professionalId) return next(new AppError('Unauthorized', 401));

    const validatedData = seaServiceStepSchema.parse(req.body);

    const resume = await prisma.professionalResume.findUnique({
      where: { professionalId },
    });
    if (!resume) return next(new AppError('Resume not found', 404));

    await prisma.professionalSeaServiceLog.create({
      data: { ...validatedData, resumeId: resume.id },
    });

    res
      .status(201)
      .json({ status: 'success', message: 'Sea service log added' });
  },
);

/**
 * Step 11a: Academic Qualifications
 */
export const addEducation = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    if (!professionalId) return next(new AppError('Unauthorized', 401));

    const validatedData = educationStepSchema.parse(req.body);

    const resume = await prisma.professionalResume.findUnique({
      where: { professionalId },
    });
    if (!resume) return next(new AppError('Resume not found', 404));

    await prisma.professionalEducation.create({
      data: { ...validatedData, resumeId: resume.id },
    });

    res.status(201).json({ status: 'success', message: 'Education added' });
  },
);

/**
 * Step 11b: STCW Certificates
 */
export const addSTCWCertificate = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    if (!professionalId) return next(new AppError('Unauthorized', 401));

    const validatedData = stcwCertificateStepSchema.parse(req.body);

    const resume = await prisma.professionalResume.findUnique({
      where: { professionalId },
    });
    if (!resume) return next(new AppError('Resume not found', 404));

    await prisma.professionalSTCWCertificate.create({
      data: { ...validatedData, resumeId: resume.id },
    });

    res
      .status(201)
      .json({ status: 'success', message: 'STCW Certificate added' });
  },
);

/**
 * Step 12: Medical & Travel Documents
 */
export const addMedicalTravelDocument = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    if (!professionalId) return next(new AppError('Unauthorized', 401));

    const validatedData = medicalTravelStepSchema.parse(req.body);
    const { type, ...docData } = validatedData;

    const resume = await prisma.professionalResume.findUnique({
      where: { professionalId },
    });
    if (!resume) return next(new AppError('Resume not found', 404));

    if (type === 'MEDICAL') {
      await prisma.professionalMedicalCertificate.create({
        data: { ...docData, resumeId: resume.id },
      });
    } else {
      await prisma.professionalTravelDocument.create({
        data: { ...docData, resumeId: resume.id },
      });
    }

    res
      .status(201)
      .json({ status: 'success', message: `${type} document added` });
  },
);

/**
 * Step 13: Biometrics
 */
export const updateBiometrics = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    if (!professionalId) return next(new AppError('Unauthorized', 401));

    const validatedData = biometricsStepSchema.parse(req.body);

    await prisma.professionalResume.upsert({
      where: { professionalId },
      create: { ...validatedData, professionalId },
      update: validatedData,
    });

    res.status(200).json({ status: 'success', message: 'Biometrics updated' });
  },
);

/**
 * Step 14: Next of Kin
 */
export const addNextOfKin = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    if (!professionalId) return next(new AppError('Unauthorized', 401));

    const validatedData = nextOfKinStepSchema.parse(req.body);

    const resume = await prisma.professionalResume.findUnique({
      where: { professionalId },
    });
    if (!resume) return next(new AppError('Resume not found', 404));

    await prisma.professionalNextOfKin.create({
      data: { ...validatedData, resumeId: resume.id },
    });

    res.status(201).json({ status: 'success', message: 'Next of kin added' });
  },
);

/**
 * Step 15: Referees
 */
export const addReferee = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    if (!professionalId) return next(new AppError('Unauthorized', 401));

    const validatedData = refereeStepSchema.parse(req.body);

    const resume = await prisma.professionalResume.findUnique({
      where: { professionalId },
    });
    if (!resume) return next(new AppError('Resume not found', 404));

    await prisma.professionalReferee.create({
      data: { ...validatedData, resumeId: resume.id },
    });

    res.status(201).json({ status: 'success', message: 'Referee added' });
  },
);

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
      // ONLY if they are provided in the request (even if empty array).
      // If a field is undefined, we leave the existing data alone.

      if (skills !== undefined) {
        await tx.professionalSkill.deleteMany({
          where: { resumeId: resume.id },
        });
        if (skills.length) {
          await tx.professionalSkill.createMany({
            data: skills.map((s) => ({ ...s, resumeId: resume.id })),
          });
        }
      }

      if (licenses !== undefined) {
        await tx.professionalLicense.deleteMany({
          where: { resumeId: resume.id },
        });
        if (licenses.length) {
          await tx.professionalLicense.createMany({
            data: licenses.map((l) => ({ ...l, resumeId: resume.id })),
          });
        }
      }

      if (seaService !== undefined) {
        await tx.professionalSeaServiceLog.deleteMany({
          where: { resumeId: resume.id },
        });
        if (seaService.length) {
          await tx.professionalSeaServiceLog.createMany({
            data: seaService.map((s) => ({ ...s, resumeId: resume.id })),
          });
        }
      }

      if (education !== undefined) {
        await tx.professionalEducation.deleteMany({
          where: { resumeId: resume.id },
        });
        if (education.length) {
          await tx.professionalEducation.createMany({
            data: education.map((e) => ({ ...e, resumeId: resume.id })),
          });
        }
      }

      if (stcwCertificates !== undefined) {
        await tx.professionalSTCWCertificate.deleteMany({
          where: { resumeId: resume.id },
        });
        if (stcwCertificates.length) {
          await tx.professionalSTCWCertificate.createMany({
            data: stcwCertificates.map((s) => ({ ...s, resumeId: resume.id })),
          });
        }
      }

      if (medicalCertificates !== undefined) {
        await tx.professionalMedicalCertificate.deleteMany({
          where: { resumeId: resume.id },
        });
        if (medicalCertificates.length) {
          await tx.professionalMedicalCertificate.createMany({
            data: medicalCertificates.map((m) => ({
              ...m,
              resumeId: resume.id,
            })),
          });
        }
      }

      if (travelDocuments !== undefined) {
        await tx.professionalTravelDocument.deleteMany({
          where: { resumeId: resume.id },
        });
        if (travelDocuments.length) {
          await tx.professionalTravelDocument.createMany({
            data: travelDocuments.map((t) => ({ ...t, resumeId: resume.id })),
          });
        }
      }

      if (nextOfKin !== undefined) {
        await tx.professionalNextOfKin.deleteMany({
          where: { resumeId: resume.id },
        });
        if (nextOfKin.length) {
          await tx.professionalNextOfKin.createMany({
            data: nextOfKin.map((n) => ({ ...n, resumeId: resume.id })),
          });
        }
      }

      if (referees !== undefined) {
        await tx.professionalReferee.deleteMany({
          where: { resumeId: resume.id },
        });
        if (referees.length) {
          await tx.professionalReferee.createMany({
            data: referees.map((r) => ({ ...r, resumeId: resume.id })),
          });
        }
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
        professional: {
          select: {
            firstName: true,
            middleName: true,
            lastName: true,
            profilePhotoUrl: true,
          },
        },
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

    const { professional, ...resumeData } = resume;

    res.status(200).json({
      status: 'success',
      data: {
        resume: {
          ...resumeData,
          firstName: professional.firstName,
          middleName: professional.middleName,
          lastName: professional.lastName,
          profilePhotoUrl: professional.profilePhotoUrl,
          // Ensure arrays are explicitly included (though spread should handle it)
          skills: resume.skills || [],
          licenses: resume.licenses || [],
          seaService: resume.seaService || [],
          education: resume.education || [],
          stcwCertificates: resume.stcwCertificates || [],
          medicalCertificates: resume.medicalCertificates || [],
          travelDocuments: resume.travelDocuments || [],
          nextOfKin: resume.nextOfKin || [],
          referees: resume.referees || [],
        },
      },
    });
  },
);

export const deleteResume = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;

    if (!professionalId) {
      return next(new AppError('Unauthorized', 401));
    }

    const resume = await prisma.professionalResume.findUnique({
      where: { professionalId },
    });

    if (!resume) {
      return next(new AppError('Resume not found', 404));
    }

    await prisma.professionalResume.delete({
      where: { professionalId },
    });

    res.status(204).json({
      status: 'success',
      data: null,
    });
  },
);
