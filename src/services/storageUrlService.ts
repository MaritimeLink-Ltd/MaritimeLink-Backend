import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

/**
 * Short-lived links for stored files.
 *
 * Every upload stores a permanent public URL in the database
 * (`…/storage/v1/object/public/<bucket>/<path>`). Those stored values are left
 * exactly as they are. Instead, whenever the API sends one of those URLs to a
 * client, it is swapped for a signed URL that stops working after 7 days
 * (`…/storage/v1/object/sign/<bucket>/<path>?token=…`). Clients treat it as an
 * opaque link, so the response shape does not change.
 *
 * While the buckets are still public both kinds of link open the file, so this
 * can be deployed first; afterwards the buckets can be switched to private,
 * at which point a URL that leaked (logs, browser history, an old recruiter
 * screen) no longer opens the file once it expires.
 *
 * If signing fails or is slow, the original URL is sent instead (see
 * middlewares/responseSafety), so a storage hiccup never blocks or breaks a
 * response.
 */

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

/**
 * Links live for 7 days and are re-issued well before that (see the cache
 * below), so a screen that was left open — a wallet folder in the mobile app,
 * a recruiter's browser tab — never ends up holding a dead link, while a link
 * that leaks still stops working within a week instead of never.
 */
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

export const signedUrlTtlSeconds = (): number => {
  const raw = Number(process.env.STORAGE_SIGNED_URL_TTL_SECONDS);
  return Number.isFinite(raw) && raw >= 60
    ? Math.floor(raw)
    : DEFAULT_TTL_SECONDS;
};

/** Set STORAGE_SIGNED_URLS=false to send stored URLs unchanged (kill switch). */
export const isStorageUrlSigningEnabled = (): boolean =>
  String(process.env.STORAGE_SIGNED_URLS ?? 'true').toLowerCase() !== 'false';

const managedBuckets = (): Set<string> =>
  new Set(
    [
      env.SUPABASE_BUCKET_NAME,
      env.SUPABASE_RECRUITER_BUCKET_NAME,
      env.SUPABASE_RECRUITER_KYC_DOCS_BUCKET,
      env.SUPABASE_RECRUITER_KYC_SELFIES_BUCKET,
      env.SUPABASE_PROFESSIONAL_KYC_DOCS_BUCKET,
      env.SUPABASE_PROFESSIONAL_KYC_SELFIES_BUCKET,
      env.SUPABASE_DOCUMENT_WALLET_BUCKET,
      env.SUPABASE_RESUME_BUCKET,
    ].filter((b): b is string => typeof b === 'string' && b.length > 0),
  );

const storageBase = () =>
  `${env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/`;

export type StorageObjectRef = { bucket: string; path: string };

/**
 * Recognises a URL that points at one of our storage buckets, in either the
 * public or the signed form, and returns its bucket + object path.
 */
export const parseStorageUrl = (value: unknown): StorageObjectRef | null => {
  if (typeof value !== 'string') return null;
  const base = storageBase();
  if (!value.startsWith(base)) return null;
  const rest = value.slice(base.length);
  const match = rest.match(/^(public|sign)\/([^/?#]+)\/([^?#]+)/);
  if (!match) return null;
  const bucket = decodeURIComponent(match[2]);
  if (!managedBuckets().has(bucket)) return null;
  let path: string;
  try {
    path = decodeURIComponent(match[3]);
  } catch {
    return null;
  }
  if (!path) return null;
  return { bucket, path };
};

/** The permanent public form of a storage URL (what the database stores). */
export const toCanonicalStorageUrl = (value: string): string => {
  const ref = parseStorageUrl(value);
  if (!ref) return value;
  const { data } = supabase.storage.from(ref.bucket).getPublicUrl(ref.path);
  return data.publicUrl;
};

type CacheEntry = { url: string; expiresAt: number };
const signedCache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 20000;

const cacheKey = (ref: StorageObjectRef) => `${ref.bucket}\u0000${ref.path}`;

const rememberSigned = (key: string, url: string, ttlSeconds: number) => {
  if (signedCache.size >= MAX_CACHE_ENTRIES) {
    // Drop the oldest quarter; Map iterates in insertion order.
    let toDrop = Math.floor(MAX_CACHE_ENTRIES / 4);
    for (const k of signedCache.keys()) {
      signedCache.delete(k);
      if (--toDrop <= 0) break;
    }
  }
  signedCache.set(key, { url, expiresAt: Date.now() + ttlSeconds * 1000 });
};

/**
 * Signs a batch of storage URLs. Returns a map from each input URL to the URL
 * that should be sent instead (the input itself when it is not one of ours or
 * could not be signed).
 */
export const signStorageUrls = async (
  urls: Iterable<string>,
): Promise<Map<string, string>> => {
  const result = new Map<string, string>();
  const defaultTtl = signedUrlTtlSeconds();
  const now = Date.now();
  // "bucket \0 ttl" -> path -> input urls
  const pendingByGroup = new Map<string, Map<string, string[]>>();

  for (const url of urls) {
    if (result.has(url)) continue;
    const ref = parseStorageUrl(url);
    if (!ref) {
      result.set(url, url);
      continue;
    }
    const ttl = defaultTtl;
    const cached = signedCache.get(cacheKey(ref));
    // Reuse a cached link only while it still has at least 90% of its life
    // left, so every link handed out stays valid for (almost) the full TTL.
    if (cached && cached.expiresAt - now > ttl * 1000 * 0.9) {
      result.set(url, cached.url);
      continue;
    }
    result.set(url, url); // fallback until signed
    const group = `${ref.bucket}\u0000${ttl}`;
    const byPath = pendingByGroup.get(group) ?? new Map<string, string[]>();
    const list = byPath.get(ref.path) ?? [];
    list.push(url);
    byPath.set(ref.path, list);
    pendingByGroup.set(group, byPath);
  }

  await Promise.all(
    [...pendingByGroup.entries()].map(async ([group, byPath]) => {
      const [bucket, ttlText] = group.split('\u0000');
      const ttl = Number(ttlText);
      const paths = [...byPath.keys()];
      try {
        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrls(paths, ttl);
        if (error || !Array.isArray(data)) return;
        for (const item of data) {
          if (!item?.path || !item.signedUrl || item.error) continue;
          rememberSigned(
            cacheKey({ bucket, path: item.path }),
            item.signedUrl,
            ttl,
          );
          for (const original of byPath.get(item.path) ?? []) {
            result.set(original, item.signedUrl);
          }
        }
      } catch (err) {
        console.error(
          '[storage] signing URLs failed, sending stored URLs:',
          (err as Error)?.message,
        );
      }
    }),
  );

  return result;
};

/**
 * URL the server itself can download a stored file from (used by the share
 * links, which stream the file to an anonymous visitor). Our own storage URLs
 * are signed first so this keeps working once the buckets are private.
 */
export const getServerFetchUrl = async (url: string): Promise<string> => {
  if (!parseStorageUrl(url)) return url;
  const map = await signStorageUrls([url]);
  return map.get(url) ?? url;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** Collects every string in a JSON-like value that is one of our storage URLs. */
export const collectStorageUrls = (
  value: unknown,
  out = new Set<string>(),
  depth = 0,
): Set<string> => {
  if (depth > 40) return out;
  if (typeof value === 'string') {
    if (parseStorageUrl(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStorageUrls(item, out, depth + 1);
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value))
      collectStorageUrls(value[key], out, depth + 1);
  }
  return out;
};

/**
 * Returns `value` with every string found in `replacements` swapped. Objects
 * and arrays are copied only where something changed, so cached data is
 * never mutated.
 */
export const replaceStrings = (
  value: unknown,
  replace: (s: string) => string | undefined,
  depth = 0,
): unknown => {
  if (depth > 40) return value;
  if (typeof value === 'string') {
    const next = replace(value);
    return next === undefined ? value : next;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const copy = value.map((item) => {
      const next = replaceStrings(item, replace, depth + 1);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? copy : value;
  }
  if (isPlainObject(value)) {
    let changed = false;
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const next = replaceStrings(value[key], replace, depth + 1);
      if (next !== value[key]) changed = true;
      copy[key] = next;
    }
    return changed ? copy : value;
  }
  return value;
};
