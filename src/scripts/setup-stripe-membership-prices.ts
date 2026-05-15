/**
 * Creates recurring Stripe prices for professional membership (test/dev setup).
 *
 * Usage: npx tsx src/scripts/setup-stripe-membership-prices.ts
 *
 * Copy the printed price IDs into .env:
 *   STRIPE_MEMBERSHIP_PRO_PRICE_ID=price_...
 *   STRIPE_MEMBERSHIP_PREMIUM_PRICE_ID=price_...
 */
import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2026-01-28.clover',
});

async function findOrCreatePrice(params: {
  productName: string;
  unitAmount: number;
  currency: string;
}) {
  const products = await stripe.products.list({ active: true, limit: 100 });
  let product = products.data.find(
    (p) => p.name.toLowerCase() === params.productName.toLowerCase(),
  );

  if (!product) {
    product = await stripe.products.create({
      name: params.productName,
      description: 'MaritimeLink professional membership',
    });
    console.log(`Created product: ${product.name} (${product.id})`);
  } else {
    console.log(`Using product: ${product.name} (${product.id})`);
  }

  const prices = await stripe.prices.list({
    product: product.id,
    active: true,
    type: 'recurring',
    limit: 20,
  });

  const existing = prices.data.find(
    (p) =>
      p.unit_amount === params.unitAmount &&
      p.currency === params.currency &&
      p.recurring?.interval === 'month',
  );

  if (existing) {
    console.log(
      `  Existing price: ${existing.id} (${params.unitAmount / 100} ${params.currency}/month)`,
    );
    return existing.id;
  }

  const created = await stripe.prices.create({
    product: product.id,
    unit_amount: params.unitAmount,
    currency: params.currency,
    recurring: { interval: 'month' },
  });
  console.log(
    `  Created price: ${created.id} (${params.unitAmount / 100} ${params.currency}/month)`,
  );
  return created.id;
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('Missing STRIPE_SECRET_KEY in .env');
    process.exit(1);
  }

  console.log('\nSetting up membership prices in Stripe...\n');

  const proPriceId = await findOrCreatePrice({
    productName: 'Maritime Premium Professional',
    unitAmount: 1999,
    currency: 'gbp',
  });

  const premiumPriceId = await findOrCreatePrice({
    productName: 'Maritime Premium Plus',
    unitAmount: 2999,
    currency: 'gbp',
  });

  console.log('\nAdd these to Maritime-apis/.env:\n');
  console.log(`STRIPE_MEMBERSHIP_PRO_PRICE_ID=${proPriceId}`);
  console.log(`STRIPE_MEMBERSHIP_PREMIUM_PRICE_ID=${premiumPriceId}`);
  console.log('\nRestart the API server after saving .env\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
