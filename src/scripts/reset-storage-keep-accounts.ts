import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';

/**
 * Companion to reset-database-keep-accounts.ts: deletes storage objects for
 * accounts already removed from the DB. Keeps only files still referenced by
 * the surviving (kept) Professional/Recruiter rows and their KYC/documents.
 *
 *   tsx src/scripts/reset-storage-keep-accounts.ts            (dry run, lists only)
 *   tsx src/scripts/reset-storage-keep-accounts.ts --execute  (actually deletes)
 */

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const BUCKETS = [
  env.SUPABASE_BUCKET_NAME,
  env.SUPABASE_RECRUITER_BUCKET_NAME,
  env.SUPABASE_RESUME_BUCKET,
  env.SUPABASE_DOCUMENT_WALLET_BUCKET,
  env.SUPABASE_PROFESSIONAL_KYC_DOCS_BUCKET,
  env.SUPABASE_PROFESSIONAL_KYC_SELFIES_BUCKET,
  env.SUPABASE_RECRUITER_KYC_DOCS_BUCKET,
  env.SUPABASE_RECRUITER_KYC_SELFIES_BUCKET,
];

const dryRun = !process.argv.includes('--execute');

const PUBLIC_PREFIX = `${env.SUPABASE_URL}/storage/v1/object/public/`;

/** Parses a Supabase public URL into { bucket, path }, or null if it's not one of our object URLs. */
function parsePublicUrl(
  url: string | null | undefined,
): { bucket: string; path: string } | null {
  if (!url || !url.startsWith(PUBLIC_PREFIX)) return null;
  const rest = url.slice(PUBLIC_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash === -1) return null;
  return {
    bucket: decodeURIComponent(rest.slice(0, slash)),
    path: decodeURIComponent(rest.slice(slash + 1)),
  };
}

async function buildKeepSet(): Promise<Map<string, Set<string>>> {
  const keep = new Map<string, Set<string>>();
  const add = (url: string | null | undefined) => {
    const parsed = parsePublicUrl(url);
    if (!parsed) return;
    if (!keep.has(parsed.bucket)) keep.set(parsed.bucket, new Set());
    keep.get(parsed.bucket)!.add(parsed.path);
  };

  const professionals = await prisma.professional.findMany({
    select: {
      profilePhotoUrl: true,
      cvUrl: true,
      idPassportUrl: true,
      kyc: {
        select: {
          selfieUrl: true,
          documentFrontUrl: true,
          documentBackUrl: true,
        },
      },
      documents: { select: { fileUrl: true } },
    },
  });
  for (const p of professionals) {
    add(p.profilePhotoUrl);
    add(p.cvUrl);
    add(p.idPassportUrl);
    add(p.kyc?.selfieUrl);
    add(p.kyc?.documentFrontUrl);
    add(p.kyc?.documentBackUrl);
    for (const d of p.documents) add(d.fileUrl);
  }

  const recruiters = await prisma.recruiter.findMany({
    select: {
      profilePhotoUrl: true,
      idPassportUrl: true,
      companyLogo: true,
      kyc: {
        select: {
          selfieUrl: true,
          documentFrontUrl: true,
          documentBackUrl: true,
          documentUrl: true,
        },
      },
    },
  });
  for (const r of recruiters) {
    add(r.profilePhotoUrl);
    add(r.idPassportUrl);
    add(r.companyLogo);
    add(r.kyc?.selfieUrl);
    add(r.kyc?.documentFrontUrl);
    add(r.kyc?.documentBackUrl);
    add(r.kyc?.documentUrl);
  }

  const companies = await prisma.company.findMany({
    select: { logoUrl: true },
  });
  for (const c of companies) add(c.logoUrl);

  return keep;
}

/** Recursively lists every object (not folder) in a bucket, returning full paths. */
async function listAllObjects(bucket: string, prefix = ''): Promise<string[]> {
  const paths: string[] = [];
  const limit = 1000;
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error)
      throw new Error(`list failed for ${bucket}/${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Supabase represents folders as entries with id === null
      if (entry.id === null) {
        paths.push(...(await listAllObjects(bucket, fullPath)));
      } else {
        paths.push(fullPath);
      }
    }

    if (data.length < limit) break;
    offset += limit;
  }

  return paths;
}

async function main() {
  console.log(
    `[storage-reset] mode: ${dryRun ? 'DRY RUN (no changes)' : 'EXECUTE (files will be deleted)'}`,
  );

  const keepSet = await buildKeepSet();
  console.log('\n[storage-reset] keep-set built from surviving DB rows:');
  for (const [bucket, paths] of keepSet) {
    console.log(`  ${bucket}: ${paths.size} file(s) to keep`);
  }

  let totalDeleted = 0;
  let totalKept = 0;

  for (const bucket of BUCKETS) {
    const allObjects = await listAllObjects(bucket);
    const keepPaths = keepSet.get(bucket) ?? new Set<string>();
    const toDelete = allObjects.filter((p) => !keepPaths.has(p));
    const kept = allObjects.length - toDelete.length;

    console.log(
      `\n[${bucket}] total: ${allObjects.length}, keep: ${kept}, ${dryRun ? 'would delete' : 'deleting'}: ${toDelete.length}`,
    );
    if (toDelete.length > 0) {
      console.log(
        `  sample: ${toDelete.slice(0, 5).join(', ')}${toDelete.length > 5 ? ', ...' : ''}`,
      );
    }

    totalKept += kept;
    totalDeleted += toDelete.length;

    if (!dryRun && toDelete.length > 0) {
      // remove() accepts a batch of paths; chunk defensively for very large buckets
      for (let i = 0; i < toDelete.length; i += 100) {
        const chunk = toDelete.slice(i, i + 100);
        const { error } = await supabase.storage.from(bucket).remove(chunk);
        if (error)
          throw new Error(`remove failed for ${bucket}: ${error.message}`);
      }
      console.log(`  deleted ${toDelete.length} object(s) from ${bucket}`);
    }
  }

  console.log(
    `\n[storage-reset] ${dryRun ? 'DRY RUN' : 'EXECUTE'} complete — kept ${totalKept}, ${dryRun ? 'would delete' : 'deleted'} ${totalDeleted} across ${BUCKETS.length} buckets.`,
  );
  if (dryRun) console.log('[storage-reset] Re-run with --execute to apply.');
}

main()
  .catch((err) => {
    console.error('[storage-reset] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
