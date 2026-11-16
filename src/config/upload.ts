import multer from 'multer';
import path from 'node:path';
import { AppError } from '../utils/AppError.js';

/**
 * Shared multer setup for every upload route.
 *
 * Files are still held in memory and handed to the same controllers as
 * before; this only adds the two guards the old `multer({ storage })` setup
 * lacked:
 *  - a size cap, so a single oversized request can't exhaust server memory
 *    (the apps themselves cap uploads at 5–10 MB, so 25 MB never affects a
 *    genuine upload);
 *  - a block on file types that a browser would execute when opened (HTML,
 *    SVG, scripts, executables). Documents, images, CVs and CSVs are
 *    unaffected.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const BLOCKED_MIME_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'application/javascript',
  'text/javascript',
  'application/x-javascript',
  'application/ecmascript',
  'text/ecmascript',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-sh',
  'application/x-httpd-php',
  'application/java-archive',
]);

const BLOCKED_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.xhtml',
  '.shtml',
  '.svg',
  '.svgz',
  '.js',
  '.mjs',
  '.cjs',
  '.exe',
  '.msi',
  '.bat',
  '.cmd',
  '.sh',
  '.php',
  '.jar',
]);

export const UPLOAD_TYPE_NOT_ALLOWED_MESSAGE =
  'This file type is not allowed. Please upload a PDF, image or document file.';

export const isBlockedUpload = (file: {
  mimetype?: string;
  originalname?: string;
}): boolean => {
  const mime = String(file.mimetype || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  const ext = path.extname(String(file.originalname || '')).toLowerCase();
  return BLOCKED_MIME_TYPES.has(mime) || BLOCKED_EXTENSIONS.has(ext);
};

export const createUpload = () =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES },
    fileFilter: (_req, file, cb) => {
      if (isBlockedUpload(file)) {
        cb(new AppError(UPLOAD_TYPE_NOT_ALLOWED_MESSAGE, 400));
        return;
      }
      cb(null, true);
    },
  });
