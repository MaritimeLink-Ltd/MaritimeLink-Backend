import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { prisma } from '../config/prisma.js';
import { CustomRequest } from '../types/index.js';

interface JWTPayload {
  id: string;
}

export const protectChat = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    let token;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next(
        new AppError(
          'You are not logged in! Please log in to get access.',
          401,
        ),
      );
    }

    const decoded = jwt.verify(token, env.JWT_SECRET) as unknown as JWTPayload;

    // 1) Try finding as Professional
    const professional = await prisma.professional.findUnique({
      where: { id: decoded.id },
    });

    if (professional) {
      req.user = {
        id: professional.id,
        email: professional.email,
        userType: 'PROFESSIONAL',
      };
      return next();
    }

    // 2) Try finding as Recruiter
    const recruiter = await prisma.recruiter.findUnique({
      where: { id: decoded.id },
    });

    if (recruiter) {
      if (recruiter.status !== 'APPROVED') {
        return next(
          new AppError('Your account is not approved by admin yet.', 403),
        );
      }
      req.user = {
        id: recruiter.id,
        email: recruiter.email,
        role: recruiter.role,
        userType: 'RECRUITER',
      };
      return next();
    }

    // 3) Try finding as Admin
    const admin = await prisma.admin.findUnique({
      where: { id: decoded.id },
    });

    if (admin) {
      req.user = {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        userType: 'ADMIN',
      };
      return next();
    }

    return next(
      new AppError('The user belonging to this token no longer exists.', 401),
    );
  },
);
