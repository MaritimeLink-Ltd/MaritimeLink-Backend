export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  /** Stable machine-readable identifier the frontend can key UI decisions off (e.g. showing an upgrade dialog). */
  code?: string;
  /** Extra structured fields the frontend needs to act on the error (e.g. IDs to resume a flow). */
  data?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    code?: string,
    data?: Record<string, unknown>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = code;
    this.data = data;

    Error.captureStackTrace(this, this.constructor);
  }
}
