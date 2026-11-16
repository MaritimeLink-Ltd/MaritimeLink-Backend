import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError.js';
import { MAX_UPLOAD_BYTES } from '../config/upload.js';

/** Stable code the clients can use to drop a dead session and show login. */
export const INVALID_SESSION_CODE = 'INVALID_SESSION';

const isPrismaError = (err: Error) =>
  typeof err?.name === 'string' && err.name.startsWith('PrismaClient');

/**
 * Message for an unexpected (non-AppError) failure. Messages from the database
 * layer or the storage provider describe internals (queries, table names,
 * provider errors) and are replaced with a generic one; everything else keeps
 * its existing message.
 */
const publicMessageFor = (err: Error): string => {
  if (isPrismaError(err) || /prisma|invocation/i.test(err.message || '')) {
    return 'Something went wrong. Please try again.';
  }
  if (/^Supabase upload failed/i.test(err.message || '')) {
    return 'The file could not be uploaded. Please try again.';
  }
  return err.message || 'Something went wrong!';
};

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction,
): void => {
  if (err instanceof ZodError) {
    const message =
      err.issues[0]?.message || 'Please check your input and try again.';
    res.status(400).json({
      status: 'error',
      message,
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
      ...(err.code && { code: err.code }),
      ...(err.data && { data: err.data }),
    });
    return;
  }

  // Missing, malformed, expired or wrongly-signed session token: this is an
  // authentication failure (401), not a server error (500), so the apps can
  // send the user back to the login screen.
  if (
    err instanceof jwt.TokenExpiredError ||
    err instanceof jwt.JsonWebTokenError ||
    err instanceof jwt.NotBeforeError
  ) {
    res.status(401).json({
      status: 'error',
      message:
        err instanceof jwt.TokenExpiredError
          ? 'Your session has expired. Please log in again.'
          : 'Your session is no longer valid. Please log in again.',
      code: INVALID_SESSION_CODE,
    });
    return;
  }

  if (err instanceof multer.MulterError) {
    res.status(400).json({
      status: 'error',
      message:
        err.code === 'LIMIT_FILE_SIZE'
          ? `File is too large. The maximum size is ${Math.round(
              MAX_UPLOAD_BYTES / (1024 * 1024),
            )} MB.`
          : 'The upload could not be processed. Please try again with a single file.',
    });
    return;
  }

  console.error('ERROR 💥', err);

  const response = {
    status: 'error',
    message: publicMessageFor(err),
    ...(process.env.NODE_ENV === 'development' && {
      error: err,
      stack: err.stack,
    }),
  };

  res.status(500).json(response);
};
