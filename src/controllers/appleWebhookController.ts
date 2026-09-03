import { Response } from 'express';
import { NotificationTypeV2 } from '@apple/app-store-server-library';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';
import {
  verifyAppleNotification,
  verifyAppleTransaction,
  syncAppleMembershipFromNotification,
} from '../services/appleIapService.js';

/**
 * App Store Server Notifications V2 — iOS app only, no effect on the
 * website/Stripe flow. Configure this URL for BOTH Production and Sandbox
 * in App Store Connect (they're separate subscriptions in App Store Connect,
 * each pointing here). Apple retries on anything but a 200, so this always
 * acknowledges once the notification itself verifies, even if the specific
 * event type isn't one we act on.
 */

const RENEW_TYPES = new Set<string>([NotificationTypeV2.DID_RENEW]);
const DEACTIVATE_TYPES = new Set<string>([
  NotificationTypeV2.EXPIRED,
  NotificationTypeV2.REFUND,
  NotificationTypeV2.REVOKE,
]);

export const handleAppleWebhook = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const signedPayload = req.body?.signedPayload as string | undefined;
    if (!signedPayload) {
      res
        .status(400)
        .json({ status: 'error', message: 'Missing signedPayload' });
      return;
    }

    let notification;
    try {
      notification = await verifyAppleNotification(signedPayload);
    } catch (error) {
      console.error('[apple-webhook] Failed to verify notification:', error);
      res.status(400).json({ status: 'error', message: 'Invalid signature' });
      return;
    }

    const notificationType = notification.notificationType;
    const signedTransactionInfo = notification.data?.signedTransactionInfo;

    if (
      !signedTransactionInfo ||
      (!RENEW_TYPES.has(String(notificationType)) &&
        !DEACTIVATE_TYPES.has(String(notificationType)))
    ) {
      // Acknowledged but not acted on — e.g. SUBSCRIBED (handled by the
      // confirm endpoint instead), DID_CHANGE_RENEWAL_STATUS, TEST, etc.
      res.status(200).json({ received: true });
      return;
    }

    const transaction = await verifyAppleTransaction(signedTransactionInfo);
    if (!transaction.originalTransactionId) {
      res.status(200).json({ received: true });
      return;
    }

    await syncAppleMembershipFromNotification({
      originalTransactionId: transaction.originalTransactionId,
      productId: transaction.productId,
      action: RENEW_TYPES.has(String(notificationType))
        ? 'RENEW'
        : 'DEACTIVATE',
    });

    res.status(200).json({ received: true });
  },
);
