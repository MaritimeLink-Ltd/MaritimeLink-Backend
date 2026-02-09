import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';

export const getPendingKYCs = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const kycs = await prisma.professionalKyc.findMany({
      where: { status: 'PENDING' },
      include: {
        professional: {
          select: {
            fullname: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      results: kycs.length,
      data: {
        kycs,
      },
    });
  },
);

/**
 * Update Professional KYC status (Approve/Reject)
 */
export const updateKYCStatus = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params; // professionalId
    const { status } = req.body; // APPROVED or REJECTED

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return next(new AppError('Invalid status', 400));
    }

    const kyc = await prisma.professionalKyc.update({
      where: { professionalId: id },
      data: { status },
    });

    res.status(200).json({
      status: 'success',
      message: `Professional KYC status updated to ${status}`,
      data: {
        kyc,
      },
    });
  },
);
