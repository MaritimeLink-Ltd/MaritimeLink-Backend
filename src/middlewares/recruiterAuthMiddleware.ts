import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { prisma } from '../config/prisma.js';
import { CustomRequest } from '../types/index.js';

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

    const decoded = jwt.verify(token, env.JWT_SECRET) as unknown as JWTPayload;

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

    if (currentRecruiter.status !== 'APPROVED') {
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
