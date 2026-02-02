import { prisma } from '../config/prisma.js';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

async function verifyStripeIntegration() {
  console.log('🚀 Starting Stripe Integration Verification...');

  // 1. Create a temporary Admin user
  const email = `test-admin-${Date.now()}@example.com`;
  const password = 'password123';

  console.log('Creating temporary admin...');
  const admin = await prisma.admin.create({
    data: {
      email,
      password,
      role: 'ADMIN',
    },
  });

  const token = jwt.sign({ id: admin.id, role: admin.role }, env.JWT_SECRET, {
    expiresIn: '1h',
  });

  const courseData = {
    title: `Stripe Test Course ${Date.now()}`,
    location: 'London',
    category: 'OFFICER',
    contractType: 'PERMANENT',
    description: 'This is a test course to verify Stripe integration.',
    price: 99.99,
  };

  try {
    console.log('--- TEST 1: Course Creation ---');
    const response = await axios.post(
      `http://127.0.0.1:${env.PORT}/api/courses`,
      courseData,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (response.status !== 201) throw new Error('Course creation failed');
    const course = response.data.data.course;
    console.log(`✅ Course Created: ${course.id}`);

    // Setup Professional
    const profEmail = `test-prof-${Date.now()}@example.com`;
    const prof = await prisma.professional.create({
      data: {
        fullname: 'Test Professional',
        email: profEmail,
        password: 'password123',
      },
    });
    const profToken = jwt.sign(
      { id: prof.id, role: 'PROFESSIONAL' },
      env.JWT_SECRET,
      { expiresIn: '1h' },
    );

    console.log('\n--- TEST 2: List Stripe Prices ---');
    const pricesRes = await axios.get(
      `http://127.0.0.1:${env.PORT}/api/professional/stripe-prices`,
      { headers: { Authorization: `Bearer ${profToken}` } },
    );
    const products = pricesRes.data.data.prices;
    console.log(`✅ Found ${products.length} products in Stripe dashboard.`);

    let targetPriceId = '';
    if (products.length > 0 && products[0].prices.length > 0) {
      targetPriceId = products[0].prices[0].id;
      console.log(
        `💡 Selected Price ID for manual test: ${targetPriceId} (Product: ${products[0].name})`,
      );
    }

    console.log('\n--- TEST 3: Checkout with Manual Price ID ---');
    if (targetPriceId) {
      const manualRes = await axios.post(
        `http://127.0.0.1:${env.PORT}/api/professional/courses/${course.id}/checkout`,
        { priceId: targetPriceId },
        { headers: { Authorization: `Bearer ${profToken}` } },
      );
      if (manualRes.status === 200) {
        console.log('✅ Manual Checkout Success!');
        console.log(`🔗 URL: ${manualRes.data.data.checkoutUrl}`);

        console.log('Cleaning up manual booking to allow fallback test...');
        await prisma.courseBooking.deleteMany({
          where: { courseId: course.id, professionalId: prof.id },
        });
      }
    } else {
      console.log('⚠️ Skipping manual checkout test (no prices found).');
    }

    console.log('\n--- TEST 4: Checkout with Fallback (No ID) ---');
    const fallbackRes = await axios.post(
      `http://127.0.0.1:${env.PORT}/api/professional/courses/${course.id}/checkout`,
      {},
      { headers: { Authorization: `Bearer ${profToken}` } },
    );
    if (fallbackRes.status === 200) {
      console.log('✅ Fallback Checkout Success!');
      console.log(`🔗 URL: ${fallbackRes.data.data.checkoutUrl}`);
    }

    // Cleanup
    console.log('\n--- CLEANUP ---');
    await prisma.courseBooking.deleteMany({ where: { courseId: course.id } });
    await prisma.course.delete({ where: { id: course.id } });
    await prisma.admin.delete({ where: { id: admin.id } });
    await prisma.professional.delete({ where: { id: prof.id } });
    console.log('🧹 Cleanup complete.');
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = error as any;
    console.error('❌ Error during verification:', err.message);
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Data:', JSON.stringify(err.response.data, null, 2));
    }
  }
}

verifyStripeIntegration();
