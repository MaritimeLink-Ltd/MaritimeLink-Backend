import twilio from 'twilio';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

/**
 * Service to handle SMS notifications using Twilio.
 */
export const sendSMS = async (to: string, message: string) => {
  if (
    !env.TWILIO_ACCOUNT_SID ||
    !env.TWILIO_AUTH_TOKEN ||
    !env.TWILIO_PHONE_NUMBER
  ) {
    console.warn(
      '[SMS] Twilio credentials not configured. Logging to console instead.',
    );
    console.log(`[SMS] Sending to ${to}: ${message}`);
    return { status: 'logged', provider: 'console' };
  }

  try {
    const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    const response = await client.messages.create({
      body: message,
      from: env.TWILIO_PHONE_NUMBER,
      to,
    });

    console.log(`[SMS] Sent successfully: ${response.sid}`);
    return { status: 'sent', provider: 'twilio', sid: response.sid };
  } catch (error) {
    console.error('[SMS] Error sending message via Twilio:', error);
    throw error;
  }
};

/**
 * Twilio Verify handles phone OTP end to end — it generates the code, sends it,
 * and checks it — so nothing is stored on our side and no Twilio number is
 * purchased. When the Verify service is not configured the callers fall back to
 * the locally generated code they used before.
 */
export const isPhoneVerifyConfigured = () =>
  Boolean(
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_VERIFY_SERVICE_SID,
  );

const verifyService = () =>
  twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN).verify.v2.services(
    env.TWILIO_VERIFY_SERVICE_SID as string,
  );

/** Joins a dial code and subscriber number into the E.164 form Verify expects. */
export const toE164 = (phoneCode: string, phoneNumber: string) => {
  const code = phoneCode.replace(/[^\d]/g, '');
  const number = phoneNumber.replace(/[^\d]/g, '').replace(/^0+/, '');
  return `+${code}${number}`;
};

/** Twilio error codes that mean "the user asked for too many codes". */
const RATE_LIMIT_CODES = new Set([60203, 60212, 60410]);

/** Sends a fresh OTP over SMS. Twilio keeps one pending code per number. */
export const startPhoneVerification = async (to: string) => {
  try {
    const verification = await verifyService().verifications.create({
      to,
      channel: 'sms',
    });

    console.log(
      `[VERIFY] Started ${verification.sid} for ${to} (${verification.status})`,
    );
    return verification;
  } catch (error) {
    const code = (error as { code?: number }).code;
    console.error(`[VERIFY] Failed to send code to ${to}:`, error);

    if (code && RATE_LIMIT_CODES.has(code)) {
      throw new AppError(
        'Too many verification attempts. Please wait a few minutes and try again.',
        429,
      );
    }
    if (code === 60200 || code === 60205 || code === 60033) {
      throw new AppError(
        'This phone number cannot receive SMS verification codes.',
        400,
      );
    }
    if (code === 21608) {
      // Trial accounts may only message numbers added as Verified Caller IDs.
      throw new AppError(
        'SMS verification is not available for this number yet. Please contact support.',
        400,
      );
    }
    if (code === 60605) {
      // The country is switched off under Verify's *own* geo permissions
      // (Console → Verify → Settings), which are separate from the Messaging
      // ones — worth naming, because the generic message sends you hunting.
      console.error(
        `[VERIFY] ${to} is blocked by Verify Geo-Permissions. Enable the country for the SMS channel under Verify → Settings → Geo Permissions.`,
      );
      throw new AppError(
        'SMS verification is not available for this country yet. Please contact support.',
        400,
      );
    }
    throw new AppError(
      'Could not send the verification code. Please try again.',
      502,
    );
  }
};

/**
 * Why a code was rejected. "Wrong digits" and "there is no live code to check
 * against" need different advice — retyping helps the first and never helps the
 * second — so they are reported separately rather than collapsed into a
 * boolean.
 */
export type PhoneCheckResult = 'approved' | 'mismatch' | 'no_pending_code';

/**
 * Asks Twilio to approve a code. Requesting a new code (Resend) cancels the
 * previous one, so a code the user still has on screen can be correct and yet
 * no longer checkable — that case comes back as `no_pending_code`.
 */
export const checkPhoneVerification = async (
  to: string,
  code: string,
): Promise<PhoneCheckResult> => {
  try {
    const check = await verifyService().verificationChecks.create({ to, code });

    // A wrong code and a correct one both return 200 — only the status
    // separates them, so log it. Without this a rejected code is
    // indistinguishable from a misconfiguration in the server logs.
    console.log(`[VERIFY] Checked code for ${to}: ${check.status}`);
    return check.status === 'approved' ? 'approved' : 'mismatch';
  } catch (error) {
    const errorCode = (error as { code?: number; status?: number }).code;

    if (errorCode === 20404 || errorCode === 60200) {
      // 20404: no live verification for this number — it expired, was already
      // approved, or a newer Resend replaced it. This is the usual reason an
      // otherwise-correct code suddenly stops working.
      console.warn(
        `[VERIFY] No pending verification for ${to} (Twilio ${errorCode}). The code expired, was already used, or was replaced by a newer one.`,
      );
      return 'no_pending_code';
    }
    if (errorCode === 60202) {
      throw new AppError(
        'Too many incorrect attempts. Please request a new code.',
        429,
      );
    }

    console.error(`[VERIFY] Failed to check code for ${to}:`, error);
    throw new AppError(
      'Could not check the verification code. Please try again.',
      502,
    );
  }
};
