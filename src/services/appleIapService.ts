import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SignedDataVerifier,
  Environment,
  VerificationException,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { logActivity } from './activityLogger.js';
import { ActionStatus, ActorType } from '../generated/client/index.js';
import { AppError } from '../utils/AppError.js';
import {
  notifyPaymentOutcome,
  safeNotify,
} from './eventNotificationService.js';

/**
 * Apple In-App Purchase verification and entitlement — iOS app only, no
 * effect on the website/Stripe flow (see stripeService.ts, untouched).
 *
 * Verifies the client-submitted StoreKit 2 signed transaction directly
 * against Apple's public root certificate chain (expiry + revocation checked
 * from the transaction's own signed fields) rather than round-tripping to
 * Apple's REST API — this needs only APPLE_BUNDLE_ID / APPLE_IAP_PRODUCT_ID /
 * APPLE_APP_APPLE_ID, not the separate "In-App Purchase" private key Apple's
 * server-to-server API would additionally require. The webhook
 * (App Store Server Notifications V2) keeps entitlement in sync afterward,
 * which is the architecture Apple's own guidance treats as sufficient.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isAppleConfigured = () =>
  Boolean(env.APPLE_BUNDLE_ID && env.APPLE_IAP_PRODUCT_ID);

const requireAppleConfigured = () => {
  if (!isAppleConfigured()) {
    throw new AppError(
      'Apple in-app purchase is not configured on this server',
      503,
    );
  }
};

let cachedRootCAs: Buffer[] | null = null;

/** Apple's public root certificate, downloaded from apple.com/certificateauthority — not a secret. */
const loadRootCAs = (): Buffer[] => {
  if (cachedRootCAs) return cachedRootCAs;
  const certPath = path.join(__dirname, '../config/certs/AppleRootCA-G3.cer');
  cachedRootCAs = [fs.readFileSync(certPath)];
  return cachedRootCAs;
};

let productionVerifier: SignedDataVerifier | null = null;
let sandboxVerifier: SignedDataVerifier | null = null;

/**
 * Apple's verifier is constructed for one environment at a time (Sandbox
 * during App Review / TestFlight, Production for real purchases) and rejects
 * a transaction signed for the other. Since both are legitimate depending on
 * who's testing, every verification attempts Production first and falls back
 * to Sandbox — the standard pattern for this library.
 */
const getVerifiers = (): {
  production: SignedDataVerifier;
  sandbox: SignedDataVerifier;
} => {
  requireAppleConfigured();
  const bundleId = env.APPLE_BUNDLE_ID!;
  const appAppleId = env.APPLE_APP_APPLE_ID
    ? Number(env.APPLE_APP_APPLE_ID)
    : undefined;
  const rootCAs = loadRootCAs();

  if (!productionVerifier) {
    productionVerifier = new SignedDataVerifier(
      rootCAs,
      true,
      Environment.PRODUCTION,
      bundleId,
      appAppleId,
    );
  }
  if (!sandboxVerifier) {
    // appAppleId is omitted in Sandbox per Apple's docs — a Production id would mismatch.
    sandboxVerifier = new SignedDataVerifier(
      rootCAs,
      true,
      Environment.SANDBOX,
      bundleId,
    );
  }
  return { production: productionVerifier, sandbox: sandboxVerifier };
};

/** Tries Production, falls back to Sandbox. Throws the Production error if both fail. */
const withProductionThenSandboxFallback = async <T>(
  run: (verifier: SignedDataVerifier) => Promise<T>,
): Promise<T> => {
  const { production, sandbox } = getVerifiers();
  try {
    return await run(production);
  } catch (productionError) {
    if (!(productionError instanceof VerificationException))
      throw productionError;
    try {
      return await run(sandbox);
    } catch {
      throw productionError;
    }
  }
};

export const verifyAppleTransaction = (
  signedTransactionInfo: string,
): Promise<JWSTransactionDecodedPayload> =>
  withProductionThenSandboxFallback((verifier) =>
    verifier.verifyAndDecodeTransaction(signedTransactionInfo),
  );

export const verifyAppleNotification = (
  signedPayload: string,
): Promise<ResponseBodyV2DecodedPayload> =>
  withProductionThenSandboxFallback((verifier) =>
    verifier.verifyAndDecodeNotification(signedPayload),
  );

/** Active = not expired and not revoked/refunded, per the transaction's own signed fields. */
export const isAppleTransactionActive = (
  transaction: JWSTransactionDecodedPayload,
): boolean =>
  Boolean(
    transaction.expiresDate &&
    transaction.expiresDate > Date.now() &&
    !transaction.revocationDate,
  );

export type AppleMembership = {
  tier: 'FREE' | 'PRO';
  membershipUpdatedAt: Date;
};

/**
 * Grants PRO from a verified, active transaction for the configured
 * productId. Stores the transaction's originalTransactionId so the webhook
 * (which carries no auth) can find this professional again on renew/expire.
 */
export const activateAppleMembership = async (
  professionalId: string,
  transaction: JWSTransactionDecodedPayload,
): Promise<AppleMembership> => {
  if (transaction.productId !== env.APPLE_IAP_PRODUCT_ID) {
    throw new AppError('Unrecognized subscription product', 400);
  }
  if (!isAppleTransactionActive(transaction)) {
    throw new AppError('This subscription is not currently active', 400);
  }
  if (!transaction.originalTransactionId) {
    throw new AppError('Apple transaction is missing an identifier', 400);
  }

  const professional = await prisma.professional.update({
    where: { id: professionalId },
    data: {
      tier: 'PRO',
      membershipUpdatedAt: new Date(),
      appleOriginalTransactionId: transaction.originalTransactionId,
    },
    select: { tier: true, membershipUpdatedAt: true },
  });

  await logActivity({
    action: 'MEMBERSHIP_UPGRADED',
    actorId: professionalId,
    actorType: ActorType.PROFESSIONAL,
    targetId: professionalId,
    targetType: 'Professional',
    status: ActionStatus.SUCCESS,
    metadata: {
      provider: 'apple',
      plan: 'PRO',
      appleOriginalTransactionId: transaction.originalTransactionId,
      appleTransactionId: transaction.transactionId,
    },
  });

  safeNotify('apple-membership-payment', () =>
    notifyPaymentOutcome({
      professionalId,
      success: true,
      description: 'Your Maritime Link PRO membership payment was successful.',
      amount: transaction.price != null ? transaction.price / 1000 : undefined,
      currency: transaction.currency,
    }),
  );

  return professional as AppleMembership;
};

/**
 * Webhook path: DID_RENEW keeps PRO, EXPIRED/REFUND/REVOKE drop to FREE.
 * Looked up by originalTransactionId since notifications carry no session.
 */
export const syncAppleMembershipFromNotification = async (params: {
  originalTransactionId: string;
  productId: string | undefined;
  action: 'RENEW' | 'DEACTIVATE';
}): Promise<void> => {
  if (params.productId && params.productId !== env.APPLE_IAP_PRODUCT_ID) return;

  const professional = await prisma.professional.findFirst({
    where: { appleOriginalTransactionId: params.originalTransactionId },
    select: { id: true },
  });
  if (!professional) {
    console.warn(
      `[apple-iap] Notification for unknown originalTransactionId ${params.originalTransactionId} — no professional linked yet`,
    );
    return;
  }

  const tier = params.action === 'RENEW' ? 'PRO' : 'FREE';

  await prisma.professional.update({
    where: { id: professional.id },
    data: { tier, membershipUpdatedAt: new Date() },
  });

  await logActivity({
    action:
      params.action === 'RENEW'
        ? 'MEMBERSHIP_RENEWED'
        : 'MEMBERSHIP_DOWNGRADED',
    actorId: professional.id,
    actorType: ActorType.PROFESSIONAL,
    targetId: professional.id,
    targetType: 'Professional',
    status: ActionStatus.SUCCESS,
    metadata: {
      provider: 'apple',
      appleOriginalTransactionId: params.originalTransactionId,
    },
  });
};
