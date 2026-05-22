import bcrypt from 'bcryptjs';
import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '../generated/client/index.js';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import { changePasswordSchema } from '../validations/passwordValidation.js';

const DEFAULT_COMPANY = 'MaritimeLink Global';
const DEFAULT_DEPARTMENT = 'Platform Operations';
const DEFAULT_REGION = 'Global';

type AdminProfileSettings = {
  displayName?: string;
  companyName?: string;
  department?: string;
  region?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readProfileSettings = (accountSettings: unknown): AdminProfileSettings => {
  if (!isRecord(accountSettings) || !isRecord(accountSettings.profile)) {
    return {};
  }
  const p = accountSettings.profile;
  return {
    displayName:
      typeof p.displayName === 'string' ? p.displayName.trim() : undefined,
    companyName:
      typeof p.companyName === 'string' ? p.companyName.trim() : undefined,
    department:
      typeof p.department === 'string' ? p.department.trim() : undefined,
    region: typeof p.region === 'string' ? p.region.trim() : undefined,
  };
};

const mergeProfileSettings = (
  existing: unknown,
  patch: AdminProfileSettings,
): Record<string, unknown> => {
  const base = isRecord(existing) ? { ...existing } : {};
  const prevProfile = readProfileSettings(existing);
  return {
    ...base,
    profile: {
      ...prevProfile,
      ...patch,
    },
  };
};

const titleCase = (value: string) =>
  value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

const deriveDisplayNameFromEmail = (email: string) => {
  const localPart = email.split('@')[0] || 'Admin';
  const parts = localPart.split(/[\s._-]+/).filter(Boolean);
  const firstName = parts[0] ? titleCase(parts[0]) : 'Admin';
  const lastName = parts[1] ? titleCase(parts[1]) : '';
  return [firstName, lastName].filter(Boolean).join(' ').trim() || 'Admin User';
};

const mapAdminProfile = (admin: {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
  accountSettings?: unknown;
}) => {
  const stored = readProfileSettings(admin.accountSettings);
  const derivedName = deriveDisplayNameFromEmail(admin.email);

  return {
    displayName: stored.displayName || derivedName,
    firstName: stored.displayName?.split(/\s+/)[0] || derivedName.split(/\s+/)[0],
    lastName: stored.displayName?.split(/\s+/).slice(1).join(' ') || '',
    email: admin.email,
    adminId: admin.id,
    companyName: stored.companyName || DEFAULT_COMPANY,
    department: stored.department || DEFAULT_DEPARTMENT,
    region: stored.region || DEFAULT_REGION,
    createdAt: admin.createdAt.toISOString(),
  };
};

const updateAdminProfileSchema = z
  .object({
    email: z.string().email().optional(),
    displayName: z.string().min(1).max(120).optional(),
    companyName: z.string().min(1).max(200).optional(),
    department: z.string().min(1).max(120).optional(),
    region: z.string().min(1).max(120).optional(),
    createdAt: z.string().min(1).optional(),
  })
  .refine(
    (body) =>
      body.email !== undefined ||
      body.displayName !== undefined ||
      body.companyName !== undefined ||
      body.department !== undefined ||
      body.region !== undefined ||
      body.createdAt !== undefined,
    { message: 'At least one profile field is required' },
  );

export const getAdminSettings = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const adminId = req.user?.id;
    if (!adminId) {
      return next(new AppError('Admin account not found', 401));
    }

    const admin = await prisma.admin.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        accountSettings: true,
      },
    });

    if (!admin) {
      return next(new AppError('Admin account not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: {
        profile: mapAdminProfile(admin),
      },
    });
  },
);

export const updateAdminProfile = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const adminId = req.user?.id;
    if (!adminId) {
      return next(new AppError('Admin account not found', 401));
    }

    const body = updateAdminProfileSchema.parse(req.body);

    const current = await prisma.admin.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        email: true,
        accountSettings: true,
      },
    });

    if (!current) {
      return next(new AppError('Admin account not found', 404));
    }

    if (body.email && body.email !== current.email) {
      const existingAdmin = await prisma.admin.findUnique({
        where: { email: body.email },
        select: { id: true },
      });
      if (existingAdmin && existingAdmin.id !== adminId) {
        return next(new AppError('Email is already in use', 400));
      }
    }

    const profilePatch: AdminProfileSettings = {};
    if (body.displayName !== undefined) profilePatch.displayName = body.displayName;
    if (body.companyName !== undefined) profilePatch.companyName = body.companyName;
    if (body.department !== undefined) profilePatch.department = body.department;
    if (body.region !== undefined) profilePatch.region = body.region;

    const data: Prisma.AdminUpdateInput = {};

    if (body.email) data.email = body.email;
    if (body.createdAt) {
      const parsedCreated = new Date(body.createdAt);
      if (Number.isNaN(parsedCreated.getTime())) {
        return next(new AppError('Invalid created date', 400));
      }
      data.createdAt = parsedCreated;
    }
    if (Object.keys(profilePatch).length > 0) {
      data.accountSettings = mergeProfileSettings(
        current.accountSettings,
        profilePatch,
      ) as Prisma.InputJsonValue;
    }

    const updated = await prisma.admin.update({
      where: { id: adminId },
      data,
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        accountSettings: true,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Admin profile updated successfully.',
      data: {
        profile: mapAdminProfile(updated),
      },
    });
  },
);

export const updateAdminPassword = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const adminId = req.user?.id;
    if (!adminId) {
      return next(new AppError('Admin account not found', 401));
    }

    const validatedData = changePasswordSchema.parse(req.body);
    const { oldPassword, newPassword } = validatedData;

    const admin = await prisma.admin.findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      return next(new AppError('Admin account not found', 404));
    }

    const isMatch = await bcrypt.compare(oldPassword, admin.password);
    if (!isMatch) {
      return next(new AppError('Current password is incorrect', 401));
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.admin.update({
      where: { id: adminId },
      data: { password: hashedPassword },
    });

    res.status(200).json({
      status: 'success',
      message: 'Password updated successfully.',
    });
  },
);
