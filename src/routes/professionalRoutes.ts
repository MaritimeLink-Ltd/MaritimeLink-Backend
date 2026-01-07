import { Router } from 'express';
import multer from 'multer';
import * as authController from '../controllers/professionalAuthController.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Step 1: Registration
router.post('/register', authController.register);

// Step 2: Verification
router.post('/verify-otp', authController.verifyOTP);

// Step 3: Upload ID (Multipart)
router.post(
  '/upload-id',
  upload.single('id_passport'),
  authController.uploadID,
);

// Step 4: Complete Profile
router.post('/complete-profile', authController.completeProfile);

// Login
router.post('/login', authController.login);

export default router;
