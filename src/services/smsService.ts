import twilio from 'twilio';
import { env } from '../config/env.js';

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
