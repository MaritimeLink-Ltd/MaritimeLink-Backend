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

export const protect = catchAsync(
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

    const currentUser = await prisma.professional.findUnique({
      where: { id: decoded.id },
    });
    if (!currentUser) {
      return next(
        new AppError('The user belonging to this token no longer exists.', 401),
      );
    }

    req.user = {
      id: currentUser.id,
      email: currentUser.email,
    };
    next();
  },
);
