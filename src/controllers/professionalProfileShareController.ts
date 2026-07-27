import { Response, NextFunction } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { env } from '../config/env.js';
import { CustomRequest } from '../types/index.js';
import { logActivity } from '../services/activityLogger.js';
import { getDocumentDisplayCategory } from './professionalDocumentController.js';
import { isIdentityVerified } from '../utils/verificationBadge.js';
import {
  ActorType,
  DocumentCategory,
  ProfessionalStatus,
} from '../generated/client/index.js';

/**
 * Public "Share Profile" links.
 *
 * Stateless JWT links, mirroring the existing DOCUMENT_PACK_SHARE flow. The professional
 * picks exactly which resume/document-wallet items the recipient may see, and the allowed
 * document ids are baked into the token — the public endpoints never widen that selection.
 */

const DEFAULT_TTL_HOURS = 24;
const MIN_TTL_HOURS = 1;
const MAX_TTL_HOURS = 168; // 7 days — matches the existing document pack ceiling.

/** Keeps the signed token (and therefore the share URL) at a sane length. */
const MAX_SHARED_DOCUMENTS = 40;

const PROFILE_SHARE_TOKEN_TYPE = 'PROFILE_SHARE';

/** Never shareable through this flow — these are surfaced via the resume itself. */
const EXCLUDED_DOCUMENT_CATEGORIES = [
  DocumentCategory.CV_RESUME,
  DocumentCategory.COVER_LETTER,
];

/** Suspended/blocked accounts must not be reachable through a share link. */
const RESTRICTED_ACCOUNT_STATUSES: ProfessionalStatus[] = [
  ProfessionalStatus.SUSPENDED,
  ProfessionalStatus.BLOCKED,
];

type ProfileShareJwt = JwtPayload & {
  sub?: string;
  type?: string;
  includeResume?: boolean;
  docIds?: string[];
};

const verifyProfileShareToken = (token: string): ProfileShareJwt => {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as ProfileShareJwt;
    if (
      typeof payload.sub !== 'string' ||
      payload.type !== PROFILE_SHARE_TOKEN_TYPE
    ) {
      throw new AppError('Invalid share link', 401);
    }
    return payload;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('This link is invalid or has expired.', 401);
  }
};

const allowedDocumentIds = (payload: ProfileShareJwt): string[] =>
  Array.isArray(payload.docIds)
    ? payload.docIds.filter((id): id is string => typeof id === 'string')
    : [];

/**
 * POST /api/professional/profile/share-link
 * Body: { includeResume?: boolean, documentIds?: string[], expiresInHours?: number }
 */
export const createProfileShareLink = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    if (!professionalId) {
      return next(new AppError('User not authenticated', 401));
    }

    // Secure share links are a premium capability, matching the document pack flow.
    const professional = await prisma.professional.findUnique({
      where: { id: professionalId },
      select: { tier: true },
    });
    if (String(professional?.tier || 'FREE').toUpperCase() !== 'PRO') {
      return next(
        new AppError(
          'Premium membership is required for secure share links.',
          403,
        ),
      );
    }

    const includeResume = req.body?.includeResume !== false;

    const rawDocumentIds = Array.isArray(req.body?.documentIds)
      ? req.body.documentIds
      : [];
    const requestedIds: string[] = [
      ...new Set<string>(
        rawDocumentIds.filter(
          (id: unknown): id is string =>
            typeof id === 'string' && id.trim().length > 0,
        ),
      ),
    ];

    if (requestedIds.length > MAX_SHARED_DOCUMENTS) {
      return next(
        new AppError(
          `You can share up to ${MAX_SHARED_DOCUMENTS} documents in a single link.`,
          400,
        ),
      );
    }

    const rawHours = Number(req.body?.expiresInHours);
    const expiresInHours =
      Number.isFinite(rawHours) && rawHours > 0
        ? Math.min(Math.max(Math.round(rawHours), MIN_TTL_HOURS), MAX_TTL_HOURS)
        : DEFAULT_TTL_HOURS;

    // Only ever sign ids the caller actually owns and that are shareable.
    const ownedDocuments = requestedIds.length
      ? await prisma.professionalDocument.findMany({
          where: {
            id: { in: requestedIds },
            professionalId,
            category: { notIn: EXCLUDED_DOCUMENT_CATEGORIES },
          },
          select: { id: true },
        })
      : [];

    const docIds = ownedDocuments.map((document) => document.id);

    if (!includeResume && docIds.length === 0) {
      return next(
        new AppError(
          'Select your resume or at least one document to share.',
          400,
        ),
      );
    }

    const expiresInSeconds = expiresInHours * 60 * 60;

    const token = jwt.sign(
      {
        sub: professionalId,
        type: PROFILE_SHARE_TOKEN_TYPE,
        includeResume,
        docIds,
      },
      env.JWT_SECRET,
      { expiresIn: expiresInSeconds },
    );

    const frontendBase = env.FRONTEND_URL.replace(/\/+$/, '');
    const shareLink = `${frontendBase}/shared/profile/${encodeURIComponent(token)}`;
    const expiresAt = new Date(
      Date.now() + expiresInSeconds * 1000,
    ).toISOString();

    await logActivity({
      action: 'PROFILE_SHARED',
      actorId: professionalId,
      actorType: ActorType.PROFESSIONAL,
      targetId: professionalId,
      targetType: 'Professional',
      metadata: {
        source: 'career_summary',
        includeResume,
        documentCount: docIds.length,
        linkExpiresInSeconds: expiresInSeconds,
      },
    });

    res.status(200).json({
      status: 'success',
      data: {
        shareLink,
        expiresAt,
        expiresInSeconds,
        expiresInHours,
        includeResume,
        documentCount: docIds.length,
        previewOnly: true,
      },
    });
  },
);

/**
 * GET /api/professional/profile/shared/:token  (public)
 * Returns the career-summary view plus only the resume/documents that were shared.
 */
export const getSharedProfile = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { token } = req.params;
    if (!token) {
      return next(new AppError('Share token is required', 400));
    }

    let payload: ProfileShareJwt;
    try {
      payload = verifyProfileShareToken(token);
    } catch (error) {
      return next(error);
    }

    const professionalId = payload.sub!;
    const includeResume = payload.includeResume !== false;
    const docIds = allowedDocumentIds(payload);

    const professional = await prisma.professional.findFirst({
      where: {
        id: professionalId,
        // Moderation must revoke links that were already handed out, otherwise a
        // suspended account stays viewable until the token expires.
        status: { notIn: RESTRICTED_ACCOUNT_STATUSES },
      },
      select: {
        firstName: true,
        middleName: true,
        lastName: true,
        fullname: true,
        profession: true,
        subcategory: true,
        profilePhotoUrl: true,
        availableForWork: true,
        isVerified: true,
        status: true,
        kyc: { select: { status: true } },
      },
    });

    if (!professional) {
      return next(new AppError('This link is invalid or has expired.', 401));
    }

    // Sea service and skills always drive the summary; the detailed resume sections
    // are only attached when the professional chose to share their resume.
    const resume = await prisma.professionalResume.findUnique({
      where: { professionalId },
      include: {
        skills: true,
        seaService: true,
        licenses: includeResume,
        education: includeResume,
        stcwCertificates: includeResume,
      },
    });

    const documents = docIds.length
      ? await prisma.professionalDocument.findMany({
          where: {
            id: { in: docIds },
            professionalId,
            category: { notIn: EXCLUDED_DOCUMENT_CATEGORIES },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            category: true,
            createdAt: true,
            verificationStatus: true,
            expiryDate: true,
            ocrData: true,
          },
        })
      : [];

    const fullName =
      professional.fullname ||
      [professional.firstName, professional.lastName].filter(Boolean).join(' ');

    const expiresAt =
      typeof payload.exp === 'number'
        ? new Date(payload.exp * 1000).toISOString()
        : null;

    res.status(200).json({
      status: 'success',
      data: {
        previewOnly: true,
        expiresAt,
        includeResume,
        profile: {
          name: fullName || 'MaritimeLink Professional',
          rank: professional.profession || professional.subcategory || null,
          profilePhotoUrl: professional.profilePhotoUrl,
          country: resume?.country || null,
          availableForWork: professional.availableForWork,
          verified: isIdentityVerified(professional),
          summary: includeResume ? resume?.summary || null : null,
        },
        seaService: (resume?.seaService || []).map((entry) => ({
          vesselType: entry.vesselType,
          vesselName: entry.vesselName,
          role: entry.role,
          joiningDate: entry.joiningDate,
          tillDate: entry.tillDate,
        })),
        skills: (resume?.skills || []).map((skill) => ({
          skillName: skill.skillName,
          rating: skill.rating,
        })),
        resume: includeResume
          ? {
              licenses: resume?.licenses || [],
              education: resume?.education || [],
              stcwCertificates: resume?.stcwCertificates || [],
            }
          : null,
        documents: documents.map((document) => ({
          id: document.id,
          name: document.name,
          category: document.category,
          createdAt: document.createdAt,
          verificationStatus: document.verificationStatus,
          expiryDate: document.expiryDate,
          displayCategory: getDocumentDisplayCategory(document),
        })),
      },
    });
  },
);

/**
 * GET /api/professional/profile/shared/:token/file/:documentId  (public)
 * Streams a shared document inline. Only ids embedded in the token are reachable.
 */
export const streamSharedProfileDocument = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { token, documentId } = req.params;
    if (!token || !documentId) {
      return next(new AppError('Not found', 404));
    }

    let payload: ProfileShareJwt;
    try {
      payload = verifyProfileShareToken(token);
    } catch (error) {
      return next(error);
    }

    if (!allowedDocumentIds(payload).includes(documentId)) {
      return next(
        new AppError('This document was not shared with this link.', 403),
      );
    }

    const document = await prisma.professionalDocument.findFirst({
      where: {
        id: documentId,
        professionalId: payload.sub!,
        category: { notIn: EXCLUDED_DOCUMENT_CATEGORIES },
        // Same moderation gate as the profile payload above.
        professional: { status: { notIn: RESTRICTED_ACCOUNT_STATUSES } },
      },
    });

    if (!document?.fileUrl) {
      return next(new AppError('Document not found', 404));
    }

    const upstream = await fetch(document.fileUrl);
    if (!upstream.ok) {
      return next(new AppError('File temporarily unavailable', 502));
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    const contentType =
      upstream.headers.get('content-type') || 'application/octet-stream';
    const safeName = String(document.name || 'document')
      .replace(/[^\w.\- ]+/g, '_')
      .trim()
      .slice(0, 120);

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(
        document.name || 'document',
      )}`,
    );
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    res.status(200).end(buf);
  },
);
