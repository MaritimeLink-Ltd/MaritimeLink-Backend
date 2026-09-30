import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';
import { logActivity } from '../services/activityLogger.js';
import { ActorType, ActionStatus } from '../generated/client/index.js';
import { getClientIp } from '../utils/requestMetadata.js';
import {
  professionalKycLoginSelect,
  mapKycForLogin,
} from '../utils/kycLoginPayload.js';
import {
  describeRestriction,
  liftExpiredProfessionalSuspension,
} from '../services/accountModerationService.js';

/**
 * Desktop → phone handoff for the Document Wallet.
 *
 * The upload screen on a laptop shows a QR code so the professional can
 * photograph documents with their phone. Scanning it should land them in
 * their own wallet, not on a login screen, so the QR carries a one-time
 * token that the phone exchanges for a normal session.
 *
 * The token is a bearer credential shown on screen, so it is kept tight:
 * random (not a JWT the `protect` middleware could accept), stored only as a
 * SHA-256 hash, valid for PHONE_HANDOFF_TTL_MINUTES, and consumed on first use.
 */
export const PHONE_HANDOFF_TTL_MINUTES = 10;

const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

const INVALID_LINK_MESSAGE =
  'This phone link has expired or was already used. Scan the QR code again from your computer, or sign in.';

/**
 * Issue a one-time phone sign-in link for the logged-in professional.
 */
export const createPhoneHandoff = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const professionalId = req.user!.id;
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + PHONE_HANDOFF_TTL_MINUTES * 60 * 1000,
    );

    // Housekeeping: this professional's used or expired tokens are dead weight.
    await prisma.phoneHandoffToken.deleteMany({
      where: {
        professionalId,
        OR: [{ usedAt: { not: null } }, { expiresAt: { lt: new Date() } }],
      },
    });

    await prisma.phoneHandoffToken.create({
      data: { tokenHash: hashToken(token), professionalId, expiresAt },
    });

    res.status(201).json({
      status: 'success',
      data: {
        token,
        expiresAt: expiresAt.toISOString(),
        expiresInSeconds: PHONE_HANDOFF_TTL_MINUTES * 60,
      },
    });
  },
);

/**
 * Exchange a phone handoff token for a session (public). Same response shape
 * as POST /api/professional/login, so the client stores it the same way.
 */
export const redeemPhoneHandoff = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!token) {
      return next(new AppError(INVALID_LINK_MESSAGE, 401));
    }

    const tokenHash = hashToken(token);
    const now = new Date();

    // Consume atomically: of two simultaneous scans, only one gets a session.
    const consumed = await prisma.phoneHandoffToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) {
      return next(new AppError(INVALID_LINK_MESSAGE, 401));
    }

    const handoff = await prisma.phoneHandoffToken.findUnique({
      where: { tokenHash },
      select: { professionalId: true },
    });
    const professional = handoff
      ? await prisma.professional.findUnique({
          where: { id: handoff.professionalId },
          include: { kyc: { select: professionalKycLoginSelect } },
        })
      : null;
    if (!professional || !professional.isVerified) {
      return next(new AppError(INVALID_LINK_MESSAGE, 401));
    }

    // Same account restrictions as a password login.
    const effectiveStatus =
      await liftExpiredProfessionalSuspension(professional);
    const restriction = describeRestriction({
      ...professional,
      status: effectiveStatus,
    });
    if (restriction) {
      return next(new AppError(restriction, 403));
    }

    const sessionToken = jwt.sign({ id: professional.id }, env.JWT_SECRET, {
      expiresIn: '7d',
    });

    await logActivity({
      action: 'LOGIN',
      actorId: professional.id,
      actorType: ActorType.PROFESSIONAL,
      status: ActionStatus.SUCCESS,
      ipAddress: getClientIp(req),
      userAgent: req.get('user-agent'),
      metadata: { method: 'phone_handoff_qr' },
    });

    const { kyc, kycSubmitted } = mapKycForLogin(professional.kyc);

    res.status(200).json({
      status: 'success',
      token: sessionToken,
      data: {
        user: {
          id: professional.id,
          fullname: professional.fullname,
          email: professional.email,
          profession: professional.profession,
          profilePhotoUrl: professional.profilePhotoUrl,
          idPassportUrl: professional.idPassportUrl,
          status: effectiveStatus,
          kyc,
          kycSubmitted,
        },
      },
    });
  },
);
