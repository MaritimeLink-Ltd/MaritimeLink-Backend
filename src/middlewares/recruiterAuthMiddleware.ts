import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { prisma } from '../config/prisma.js';
import { CustomRequest } from '../types/index.js';
import {
  describeRestriction,
  liftExpiredRecruiterSuspension,
} from '../services/accountModerationService.js';

interface JWTPayload {
  id: string;
  role: string;
}

export const protectRecruiter = catchAsync(
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

    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
    }) as unknown as JWTPayload;

    const currentRecruiter = await prisma.recruiter.findUnique({
      where: { id: decoded.id },
    });

    if (!currentRecruiter) {
      return next(
        new AppError(
          'The recruiter belonging to this token no longer exists.',
          401,
        ),
      );
    }

    const effectiveStatus =
      await liftExpiredRecruiterSuspension(currentRecruiter);
    const restriction = describeRestriction({
      ...currentRecruiter,
      status: effectiveStatus,
    });
    if (restriction) {
      return next(new AppError(restriction, 403));
    }

    if (effectiveStatus !== 'APPROVED') {
      return next(new AppError('Your account is not approved yet.', 403));
    }

    req.user = {
      id: currentRecruiter.id,
      email: currentRecruiter.email,
      role: currentRecruiter.role,
    };
    next();
  },
);

export const protectRecruiterKyc = catchAsync(
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

    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
    }) as unknown as JWTPayload;

    const currentRecruiter = await prisma.recruiter.findUnique({
      where: { id: decoded.id },
    });

    if (!currentRecruiter) {
      return next(
        new AppError(
          'The recruiter belonging to this token no longer exists.',
          401,
        ),
      );
    }

    if (
      currentRecruiter.status === 'REJECTED' ||
      currentRecruiter.status === 'BLOCKED' ||
      currentRecruiter.status === 'SUSPENDED'
    ) {
      return next(
        new AppError(
          describeRestriction(currentRecruiter) ||
            `Your account is currently ${currentRecruiter.status.toLowerCase()}. Please contact support.`,
          403,
        ),
      );
    }

    req.user = {
      id: currentRecruiter.id,
      email: currentRecruiter.email,
      role: currentRecruiter.role,
    };
    next();
  },
);

/**
 * Restricts a route to one recruiter account type (use after protectRecruiter).
 * Recruitment agents and training providers share the recruiter table, so
 * without this a recruitment agent could call training-provider endpoints
 * (and vice versa).
 */
export const requireRecruiterRole =
  (...roles: string[]) =>
  (req: CustomRequest, res: Response, next: NextFunction) => {
    if (!req.user?.role || !roles.includes(req.user.role)) {
      return next(
        new AppError(
          'This feature is not available for your account type.',
          403,
        ),
      );
    }
    next();
  };
