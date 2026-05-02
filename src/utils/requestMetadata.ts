import type { Request } from 'express';

const normalizeIp = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice(7);
  }
  return trimmed;
};

export const getClientIp = (req: Request) => {
  const clientIpHeader = req.headers['x-client-ip'];
  const forwardedFor = req.headers['x-forwarded-for'];
  const xRealIp = req.headers['x-real-ip'];
  const cfConnectingIp = req.headers['cf-connecting-ip'];
  const trueClientIp = req.headers['true-client-ip'];

  const candidates = [
    Array.isArray(clientIpHeader) ? clientIpHeader[0] : clientIpHeader,
    Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor,
    Array.isArray(xRealIp) ? xRealIp[0] : xRealIp,
    Array.isArray(cfConnectingIp) ? cfConnectingIp[0] : cfConnectingIp,
    Array.isArray(trueClientIp) ? trueClientIp[0] : trueClientIp,
    req.ip,
    req.socket?.remoteAddress,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const first = candidate.split(',')[0]?.trim();
    if (
      !first ||
      first === '::1' ||
      first === '127.0.0.1' ||
      first === 'localhost'
    ) {
      continue;
    }
    return normalizeIp(first);
  }

  const fallback = req.ip || req.socket?.remoteAddress || 'Unknown';
  return normalizeIp(fallback);
};
