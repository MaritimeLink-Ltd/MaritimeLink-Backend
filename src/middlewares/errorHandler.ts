import { Request, Response } from 'express';
import { AppError } from '../utils/AppError.js';

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
): void => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
    });
    return;
  }

  console.error('ERROR 💥', err);
  res.status(500).json({
    status: 'error',
    message: 'Something went wrong!',
  });
};
