import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { prisma } from '../config/prisma.js';
import { CustomRequest } from '../types/index.js';
import { canManageAdminTeam, canViewFinancials } from '../config/adminRoles.js';

export const ADMIN_ACCOUNT_DISABLED_MESSAGE =
  'This admin account has been deactivated. Contact a super admin if you need access again.';

/** Lets the website sign a deactivated admin out straight away. */
export const ADMIN_ACCOUNT_DISABLED_CODE = 'ADMIN_ACCOUNT_DISABLED';

export const FINANCIALS_FORBIDDEN_MESSAGE =
  'Your role does not have access to financial information.';

interface JWTPayload {
  id: string;
  role: string;
}

export const protectAdmin = catchAsync(
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

    const currentAdmin = await prisma.admin.findUnique({
      where: { id: decoded.id },
    });

    if (!currentAdmin) {
      return next(
        new AppError(
          'The admin belonging to this token no longer exists.',
          401,
        ),
      );
    }

    if (currentAdmin.disabledAt) {
      return next(
        new AppError(
          ADMIN_ACCOUNT_DISABLED_MESSAGE,
          403,
          ADMIN_ACCOUNT_DISABLED_CODE,
        ),
      );
    }

    req.user = {
      id: currentAdmin.id,
      email: currentAdmin.email,
      role: currentAdmin.role,
    };
    next();
  },
);

/** Only super admins (use after protectAdmin). */
export const requireSuperAdmin = (
  req: CustomRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!canManageAdminTeam(req.user?.role)) {
    return next(
      new AppError('Only a super admin can manage the admin team.', 403),
    );
  }
  next();
};

/**
 * Blocks roles that may not see money (revenue, commission, payouts,
 * transactions) from a purely financial endpoint (use after protectAdmin).
 */
export const requireFinancialAccess = (
  req: CustomRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!canViewFinancials(req.user?.role)) {
    return next(new AppError(FINANCIALS_FORBIDDEN_MESSAGE, 403));
  }
  next();
};
