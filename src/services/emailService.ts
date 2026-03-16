import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
});

// Verify connection configuration on startup
transporter.verify((error) => {
  if (error) {
    console.error('❌ SMTP Connection Error:', error.message);
  } else {
    console.log('✅ SMTP Server is ready to send emails');
  }
});

export const sendOTPEmail = async (to: string, otp: string) => {
  const mailOptions = {
    from: env.SMTP_FROM,
    to,
    subject: 'Verification Code for Your Professional Account',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
        <h2 style="color: #333;">Welcome!</h2>
        <p style="font-size: 16px; color: #555;">Use the following code to verify your professional account registration:</p>
        <div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
          ${otp}
        </div>
        <p style="font-size: 14px; color: #888;">This code will expire in 10 minutes.</p>
        <p style="font-size: 14px; color: #888;">If you didn't request this, please ignore this email.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

export const sendPasswordResetEmail = async (to: string, resetLink: string) => {
  const mailOptions = {
    from: env.SMTP_FROM,
    to,
    subject: 'Reset Your Account Password',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
        <h2 style="color: #333;">Password Reset Request</h2>
        <p style="font-size: 16px; color: #555;">We received a request to reset your password. Click the button below to choose a new password:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="background-color: #007bff; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Reset Password</a>
        </div>
        <p style="font-size: 14px; color: #888;">This link will expire in 1 hour.</p>
        <p style="font-size: 14px; color: #888;">If you didn't request a password reset, you can safely ignore this email.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #aaa;">Copy and paste this link if the button doesn't work:</p>
        <p style="font-size: 12px; color: #aaa; word-break: break-all;">${resetLink}</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

export const sendPhoneOTPEmail = async (to: string, otp: string) => {
  const mailOptions = {
    from: env.SMTP_FROM,
    to,
    subject: 'Phone Verification Code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
        <h2 style="color: #333;">Phone Verification</h2>
        <p style="font-size: 16px; color: #555;">Use the following code to verify your phone number:</p>
        <div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
          ${otp}
        </div>
        <p style="font-size: 14px; color: #888;">This code will expire in 10 minutes.</p>
        <p style="font-size: 14px; color: #888;">If you didn't request this, please ignore this email.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};
