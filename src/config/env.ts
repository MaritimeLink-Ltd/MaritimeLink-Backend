import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config({ override: true });

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
  JWT_SECRET: z.string().min(1),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.string().transform((val) => parseInt(val, 10)),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  SMTP_FROM: z.string().email(),
  SMTP_TLS: z.string().optional(),
  SMTP_SECURE: z.string().optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_BUCKET_NAME: z.string().default('professional-ids'),
  SUPABASE_RECRUITER_BUCKET_NAME: z.string().default('recruiter-ids'),
  SUPABASE_RECRUITER_KYC_DOCS_BUCKET: z.string().default('recruiter-kyc-docs'),
  SUPABASE_RECRUITER_KYC_SELFIES_BUCKET: z
    .string()
    .default('recruiter-kyc-selfies'),
  SUPABASE_PROFESSIONAL_KYC_DOCS_BUCKET: z
    .string()
    .default('professional-kyc-documents'),
  SUPABASE_PROFESSIONAL_KYC_SELFIES_BUCKET: z
    .string()
    .default('professional-kyc-selfies'),
  SUPABASE_DOCUMENT_WALLET_BUCKET: z.string().default('document-wallet'),
  SUPABASE_RESUME_BUCKET: z.string().default('resumes'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  BACKEND_URL: z.string().url().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  /** Optional Stripe Price IDs for professional membership (recurring). */
  STRIPE_MEMBERSHIP_PRO_PRICE_ID: z.string().optional(),
  STRIPE_MEMBERSHIP_PREMIUM_PRICE_ID: z.string().optional(),
  /** Stripe Price IDs for recruiter subscription tiers. */
  STRIPE_RECRUITER_FLEX_PRICE_ID: z.string().min(1),
  STRIPE_RECRUITER_PREMIUM_PRICE_ID: z.string().min(1),
  GEMINI_API_KEY: z.string().optional(),
  /** SerpApi key used to pull external maritime job listings (Google Jobs engine). */
  SERPAPI_KEY: z.string().optional(),
  /**
   * Ceiling on SerpApi searches per daily refresh. Actual usage is also
   * clamped to whatever the account has left this month, so this is a safe
   * default to raise if you're on a bigger plan — no code change needed.
   */
  SERPAPI_MAX_QUERIES_PER_DAY: z.string().optional(),
  /** RapidAPI key for JSearch, a second external maritime job source (independent quota from SerpApi). */
  JSEARCH_API_KEY: z.string().optional(),
  /**
   * Ceiling on JSearch searches per daily refresh. JSearch has no free
   * account-quota-check endpoint (unlike SerpApi's account.json), so this is
   * the only pre-flight budget signal — actual remaining quota is only known
   * from the `x-ratelimit-requests-remaining` header on each real response.
   */
  JSEARCH_MAX_QUERIES_PER_DAY: z.string().optional(),
  /** Comma-separated RSS/Atom job feed URLs; falls back to built-in defaults. */
  EXTERNAL_JOB_FEEDS: z.string().optional(),
  /**
   * Apple In-App Purchase (iOS app only — no effect on the website/Stripe
   * flow). Without APPLE_BUNDLE_ID set, the apple/confirm endpoint and the
   * apple webhook both reject every request rather than silently no-op,
   * since accepting an unverifiable transaction would be worse than an error.
   */
  APPLE_BUNDLE_ID: z.string().optional(),
  /** The subscription's App Store Connect product id — only this productId grants PRO. */
  APPLE_IAP_PRODUCT_ID: z.string().optional(),
  /** The app's numeric Apple ID from App Information (NOT the IAP product id) — required by Apple's verifier for the Production environment. */
  APPLE_APP_APPLE_ID: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  /** Only needed for plain SMS sends; phone OTP uses Verify instead. */
  TWILIO_PHONE_NUMBER: z.string().optional(),
  /** Twilio Verify service (VA...) used for phone OTP — needs no purchased number. */
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
