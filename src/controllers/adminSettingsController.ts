import bcrypt from 'bcryptjs';
import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import { changePasswordSchema } from '../validations/passwordValidation.js';

const titleCase = (value: string) =>
  value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

const mapAdminProfile = (admin: {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
}) => {
  const localPart = admin.email.split('@')[0] || 'Admin';
  const parts = localPart.split(/[\s._-]+/).filter(Boolean);
  const firstName = parts[0] ? titleCase(parts[0]) : 'Admin';
  const lastName = parts[1] ? titleCase(parts[1]) : '';
  const displayName = [firstName, lastName].filter(Boolean).join(' ').trim();

  return {
    displayName: displayName || 'Admin User',
    firstName,
    lastName,
    email: admin.email,
    role: admin.role,
    adminId: admin.id,
    companyName: 'MaritimeLink Global',
    department: 'Platform Operations',
    region: 'Global',
    createdAt: admin.createdAt,
  };
};

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

    const { email } = req.body as { email?: string };
    if (!email) {
      return next(new AppError('Email is required', 400));
    }

    const existingAdmin = await prisma.admin.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingAdmin && existingAdmin.id !== adminId) {
      return next(new AppError('Email is already in use', 400));
    }

    const updated = await prisma.admin.update({
      where: { id: adminId },
      data: { email },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
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
