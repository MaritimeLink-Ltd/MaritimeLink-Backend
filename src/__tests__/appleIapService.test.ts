import { prisma } from '../config/prisma.js';
import {
  isAppleTransactionActive,
  activateAppleMembership,
  syncAppleMembershipFromNotification,
} from '../services/appleIapService.js';
import type { JWSTransactionDecodedPayload } from '@apple/app-store-server-library';

const decoded = (
  overrides: Partial<JWSTransactionDecodedPayload> = {},
): JWSTransactionDecodedPayload =>
  ({
    productId: 'monthly',
    originalTransactionId: 'orig-1',
    transactionId: 'txn-1',
    expiresDate: Date.now() + 24 * 60 * 60 * 1000, // 1 day from now
    ...overrides,
  }) as JWSTransactionDecodedPayload;

describe('isAppleTransactionActive', () => {
  it('is active when expiresDate is in the future and not revoked', () => {
    expect(isAppleTransactionActive(decoded())).toBe(true);
  });

  it('is inactive when expiresDate has passed', () => {
    expect(
      isAppleTransactionActive(decoded({ expiresDate: Date.now() - 1000 })),
    ).toBe(false);
  });

  it('is inactive when revocationDate is set, even if not yet expired', () => {
    expect(
      isAppleTransactionActive(decoded({ revocationDate: Date.now() - 1000 })),
    ).toBe(false);
  });

  it('is inactive when expiresDate is missing', () => {
    expect(isAppleTransactionActive(decoded({ expiresDate: undefined }))).toBe(
      false,
    );
  });
});

describe('activateAppleMembership (real DB)', () => {
  const testRunId = Date.now();
  let professionalId: string;

  beforeAll(async () => {
    const professional = await prisma.professional.create({
      data: {
        email: `apple_iap_test_${testRunId}@example.com`,
        password: 'not-used-in-this-test',
        isVerified: true,
        status: 'VERIFIED',
      },
    });
    professionalId = professional.id;
  });

  afterAll(async () => {
    await prisma.professional
      .delete({ where: { id: professionalId } })
      .catch(() => {});
    await prisma.activityLog
      .deleteMany({ where: { actorId: professionalId } })
      .catch(() => {});
    await prisma.$disconnect();
  });

  it('rejects a transaction for the wrong productId without touching the account', async () => {
    await expect(
      activateAppleMembership(professionalId, decoded({ productId: 'yearly' })),
    ).rejects.toThrow('Unrecognized subscription product');

    const professional = await prisma.professional.findUnique({
      where: { id: professionalId },
    });
    expect(professional?.tier).toBe('FREE');
  });

  it('rejects an expired transaction', async () => {
    await expect(
      activateAppleMembership(
        professionalId,
        decoded({ expiresDate: Date.now() - 1000 }),
      ),
    ).rejects.toThrow('not currently active');
  });

  it('rejects a transaction with no appAccountToken, without touching the account', async () => {
    await expect(
      activateAppleMembership(
        professionalId,
        decoded({ appAccountToken: undefined }),
      ),
    ).rejects.toThrow('does not belong to your account');

    const professional = await prisma.professional.findUnique({
      where: { id: professionalId },
    });
    expect(professional?.tier).toBe('FREE');
  });

  it('rejects a genuine, active, correct-product transaction paid for by a different professional', async () => {
    await expect(
      activateAppleMembership(
        professionalId,
        decoded({ appAccountToken: 'some-other-professional-id' }),
      ),
    ).rejects.toThrow('does not belong to your account');

    const professional = await prisma.professional.findUnique({
      where: { id: professionalId },
    });
    expect(professional?.tier).toBe('FREE');
  });

  it('grants PRO and stores the originalTransactionId for a valid, active, correct-product transaction whose appAccountToken matches the caller', async () => {
    const membership = await activateAppleMembership(
      professionalId,
      decoded({ appAccountToken: professionalId }),
    );

    expect(membership.tier).toBe('PRO');
    expect(membership.membershipUpdatedAt).toBeInstanceOf(Date);

    const professional = await prisma.professional.findUnique({
      where: { id: professionalId },
    });
    expect(professional?.tier).toBe('PRO');
    expect(professional?.appleOriginalTransactionId).toBe('orig-1');

    const log = await prisma.activityLog.findFirst({
      where: { actorId: professionalId, action: 'MEMBERSHIP_UPGRADED' },
    });
    expect(log).not.toBeNull();
    expect((log?.metadata as Record<string, unknown>)?.provider).toBe('apple');
  });
});

describe('syncAppleMembershipFromNotification (real DB)', () => {
  const testRunId = Date.now();
  let professionalId: string;
  const originalTransactionId = `orig-notif-${testRunId}`;

  beforeAll(async () => {
    const professional = await prisma.professional.create({
      data: {
        email: `apple_iap_notif_test_${testRunId}@example.com`,
        password: 'not-used-in-this-test',
        isVerified: true,
        status: 'VERIFIED',
        tier: 'PRO',
        appleOriginalTransactionId: originalTransactionId,
      },
    });
    professionalId = professional.id;
  });

  afterAll(async () => {
    await prisma.professional
      .delete({ where: { id: professionalId } })
      .catch(() => {});
    await prisma.activityLog
      .deleteMany({ where: { actorId: professionalId } })
      .catch(() => {});
    await prisma.$disconnect();
  });

  it('does nothing for an unknown originalTransactionId (no professional linked yet)', async () => {
    await syncAppleMembershipFromNotification({
      originalTransactionId: 'no-such-transaction',
      productId: 'monthly',
      action: 'DEACTIVATE',
    });
    // No throw is the assertion here — nothing to look up, nothing to break.
  });

  it('ignores a notification for a different product entirely', async () => {
    await syncAppleMembershipFromNotification({
      originalTransactionId,
      productId: 'yearly',
      action: 'DEACTIVATE',
    });

    const professional = await prisma.professional.findUnique({
      where: { id: professionalId },
    });
    expect(professional?.tier).toBe('PRO'); // untouched
  });

  it('DEACTIVATE (expire/refund/revoke) drops the linked professional to FREE', async () => {
    await syncAppleMembershipFromNotification({
      originalTransactionId,
      productId: 'monthly',
      action: 'DEACTIVATE',
    });

    const professional = await prisma.professional.findUnique({
      where: { id: professionalId },
    });
    expect(professional?.tier).toBe('FREE');

    const log = await prisma.activityLog.findFirst({
      where: { actorId: professionalId, action: 'MEMBERSHIP_DOWNGRADED' },
    });
    expect(log).not.toBeNull();
  });

  it('RENEW restores PRO for the linked professional', async () => {
    await syncAppleMembershipFromNotification({
      originalTransactionId,
      productId: 'monthly',
      action: 'RENEW',
    });

    const professional = await prisma.professional.findUnique({
      where: { id: professionalId },
    });
    expect(professional?.tier).toBe('PRO');

    const log = await prisma.activityLog.findFirst({
      where: { actorId: professionalId, action: 'MEMBERSHIP_RENEWED' },
    });
    expect(log).not.toBeNull();
  });
});
