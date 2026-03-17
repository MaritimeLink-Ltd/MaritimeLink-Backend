import axios from 'axios';
import { prisma } from '../src/config/prisma.js';

const API_BASE_URL = 'http://localhost:3000/api';

/**
 * Script to test live SMS sending to a specific number
 */
async function testLiveSMS(targetNumber: string, targetEmail: string) {
  console.log('🚀 Starting Live SMS Test...');

  try {
    // Step 1: Register
    console.log('Step 1: Registering...');
    const regRes = await axios.post(`${API_BASE_URL}/recruiter/register`, {
      email: targetEmail,
      password: 'Password123!',
      confirmPassword: 'Password123!',
      role: 'RECRUITMENT_AGENT',
    });
    const recruiterId = regRes.data.data.recruiterId;

    // Get OTP from DB
    const recruiter = await prisma.recruiter.findUnique({
      where: { id: recruiterId },
    });
    const emailOtp = recruiter?.otpCode;

    // Step 2: Verify Email
    console.log('Step 2: Verifying Email...');
    await axios.post(`${API_BASE_URL}/recruiter/verify-otp`, {
      recruiterId,
      code: emailOtp,
    });

    // Step 3: Set Personal Info (This triggers the SMS)
    console.log(`Step 3: Triggering SMS to ${targetNumber}...`);
    // Manual split if regex fails or is complex
    const code = targetNumber.startsWith('+92') ? '+92' : '+1';
    const number = targetNumber.replace(code, '');

    await axios.patch(`${API_BASE_URL}/recruiter/personal-info`, {
      recruiterId,
      firstName: 'Test',
      lastName: 'User',
      phoneCode: code,
      phoneNumber: number,
      personalRole: 'Crew Manager',
    });

    console.log('✅ Request successful! Please check your phone for the OTP.');
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      console.error('❌ Test Failed:', error.response?.data || error.message);
    } else {
      console.error('❌ Test Failed:', (error as Error).message);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Target details from user request
testLiveSMS('+923076517703', `test-sms-${Date.now()}@example.com`);
