export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  /** Stable machine-readable identifier the frontend can key UI decisions off (e.g. showing an upgrade dialog). */
  code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = code;

    Error.captureStackTrace(this, this.constructor);
  }
}
