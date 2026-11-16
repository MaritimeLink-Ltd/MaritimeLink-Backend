import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {
  getServerFetchUrl,
  parseStorageUrl,
} from '../services/storageUrlService.js';

/**
 * Downloads a stored document for the share-link proxies.
 *
 * - Files in our own storage are fetched through a signed URL (keeps working
 *   once the buckets are private).
 * - Any other address (e.g. a certificate link a trainer typed in) is only
 *   fetched if it is a normal public http(s) address. Internal addresses —
 *   localhost, private networks, cloud metadata endpoints, in any IPv4/IPv6
 *   spelling — are refused. The check runs on the address the connection is
 *   actually made to (not a separate DNS lookup), so DNS tricks can't swap in
 *   an internal address, and every redirect hop is checked again.
 */

const MAX_REDIRECTS = 3;
const MAX_BYTES = 30 * 1024 * 1024;
const TIMEOUT_MS = 15000;

const isPrivateIPv4 = (ip: string): boolean => {
  const parts = ip.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast / reserved
  );
};

/** Expands an IPv6 address into its 8 sixteen-bit groups (null if invalid). */
const ipv6Groups = (ip: string): number[] | null => {
  let address = ip.toLowerCase().split('%')[0];
  // Trailing dotted IPv4 (e.g. ::ffff:127.0.0.1) -> two hex groups.
  const dotted = address.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const p = dotted[1].split('.').map(Number);
    if (p.length !== 4 || p.some((n) => n > 255)) return null;
    address =
      address.slice(0, -dotted[1].length) +
      `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...Array(missing).fill('0'), ...tail].map((g) =>
    parseInt(g || '0', 16),
  );
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff)
    ? groups
    : null;
};

const isPrivateIPv6 = (ip: string): boolean => {
  const g = ipv6Groups(ip);
  if (!g) return true;
  const embeddedV4 = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
  const firstFiveZero = g.slice(0, 5).every((x) => x === 0);
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (IPv4-compatible)
  if (firstFiveZero && (g[5] === 0xffff || g[5] === 0)) {
    if (g[5] === 0 && g[6] === 0 && g[7] <= 1) return true; // :: and ::1
    return isPrivateIPv4(embeddedV4);
  }
  // 64:ff9b::/96 (NAT64) embeds an IPv4 address too.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPrivateIPv4(embeddedV4);
  }
  return (
    (g[0] & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (g[0] & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (g[0] & 0xffc0) === 0xfec0 || // fec0::/10 site-local (deprecated)
    (g[0] & 0xff00) === 0xff00 || // multicast
    g[0] === 0x2002 || // 6to4 can tunnel to arbitrary IPv4
    (g[0] === 0x2001 && g[1] === 0) // Teredo
  );
};

export const isPrivateAddress = (ip: string): boolean =>
  net.isIPv4(ip)
    ? isPrivateIPv4(ip)
    : net.isIPv6(ip)
      ? isPrivateIPv6(ip)
      : true;

const hostOf = (parsed: URL) => parsed.hostname.replace(/^\[|\]$/g, '');

/** Basic shape check: absolute http(s) URL with no credentials or localhost. */
const isAcceptableUrlShape = (parsed: URL): boolean => {
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  if (parsed.username || parsed.password) return false;
  const host = hostOf(parsed);
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    return false;
  }
  return !(net.isIP(host) && isPrivateAddress(host));
};

/** True when `url` is http(s) and every address its host resolves to is public. */
export const isPublicHttpUrl = async (url: string): Promise<boolean> => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!isAcceptableUrlShape(parsed)) return false;
  const host = hostOf(parsed);
  if (net.isIP(host)) return true;
  try {
    const addresses = await dns.promises.lookup(host, {
      all: true,
      verbatim: true,
    });
    return (
      addresses.length > 0 &&
      addresses.every((entry) => !isPrivateAddress(entry.address))
    );
  } catch {
    return false;
  }
};

/**
 * DNS lookup used for the actual connection: refuses to hand the socket any
 * internal address, so the address that was checked is the one connected to.
 */
const publicOnlyLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(
    hostname,
    { ...options, all: true, verbatim: true },
    (err, addresses) => {
      if (err) {
        (callback as (e: NodeJS.ErrnoException | null) => void)(err);
        return;
      }
      const list = (addresses as unknown as dns.LookupAddress[]) ?? [];
      if (
        list.length === 0 ||
        list.some((entry) => isPrivateAddress(entry.address))
      ) {
        const blocked = new Error(
          'Refusing to connect to an internal address',
        ) as NodeJS.ErrnoException;
        blocked.code = 'EBLOCKED';
        (callback as (e: NodeJS.ErrnoException | null) => void)(blocked);
        return;
      }
      if ((options as dns.LookupOptions)?.all) {
        (
          callback as (
            e: NodeJS.ErrnoException | null,
            a: dns.LookupAddress[],
          ) => void
        )(null, list);
      } else {
        (
          callback as (
            e: NodeJS.ErrnoException | null,
            a: string,
            f: number,
          ) => void
        )(null, list[0].address, list[0].family);
      }
    },
  );
};

type RawResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
};

const requestOnce = (url: URL): Promise<RawResponse> =>
  new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      { method: 'GET', lookup: publicOnlyLookup, timeout: TIMEOUT_MS },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });

export const fetchStoredFile = async (
  storedUrl: string,
): Promise<Response | null> => {
  if (parseStorageUrl(storedUrl)) {
    return fetch(await getServerFetchUrl(storedUrl));
  }

  let current: URL;
  try {
    current = new URL(storedUrl);
  } catch {
    return null;
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isAcceptableUrlShape(current)) return null;
    let raw: RawResponse;
    try {
      raw = await requestOnce(current);
    } catch {
      return null;
    }
    if (raw.status >= 300 && raw.status < 400) {
      const location = raw.headers.location;
      if (!location) return null;
      current = new URL(location, current);
      continue;
    }
    const headers = new Headers();
    const contentType = raw.headers['content-type'];
    if (contentType) headers.set('content-type', String(contentType));
    return new Response(new Uint8Array(raw.body), {
      status: raw.status,
      headers,
    });
  }
  return null;
};

/** Types a browser may render inline from a share link; others download. */
const INLINE_SAFE_TYPES =
  /^(application\/pdf|image\/(jpeg|jpg|png|gif|webp|heic|heif|bmp|tiff))$/i;

export const safeShareContentType = (
  upstreamType: string | null,
): { contentType: string; forceDownload: boolean } => {
  const base = String(upstreamType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (INLINE_SAFE_TYPES.test(base)) {
    return { contentType: base, forceDownload: false };
  }
  return { contentType: 'application/octet-stream', forceDownload: true };
};

/** True for an absolute http(s) URL (rejects javascript:, data:, etc.). */
export const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};
