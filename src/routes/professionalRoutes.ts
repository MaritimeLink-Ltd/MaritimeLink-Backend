import { Router } from 'express';
import multer from 'multer';
import * as authController from '../controllers/professionalAuthController.js';
import * as kycController from '../controllers/professionalKycController.js';
import * as documentController from '../controllers/professionalDocumentController.js';
import * as courseController from '../controllers/professionalCourseController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * @swagger
 * /api/professional/register:
 *   post:
 *     summary: Step 1 - Register Professional
 *     description: Initialize registration for a maritime professional. Sends a 6-digit OTP to the professional's email.
 *     tags: [Professional]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firstName, lastName, email, password]
 *             properties:
 *               firstName: { type: string, example: "John" }
 *               middleName: { type: string, example: "Quincy" }
 *               lastName: { type: string, example: "Doe" }
 *               email: { type: string, format: email, example: "john.doe@example.com" }
 *               password: { type: string, format: password, example: "Password123!" }
 *     responses:
 *       201:
 *         description: Professional account created. OTP sent.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: "Registration successful. OTP sent to your email." }
 *                 data:
 *                   type: object
 *                   properties:
 *                     professionalId: { type: string, format: uuid }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */
router.post('/register', authController.register);

/**
 * @swagger
 * /api/professional/verify-otp:
 *   post:
 *     summary: Step 2 - Verify Email with OTP
 *     description: Validate the OTP code. Advance to profession selection.
 *     tags: [Professional]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [professionalId, code]
 *             properties:
 *               professionalId: { type: string, format: uuid }
 *               code: { type: string, example: "123456" }
 *     responses:
 *       200:
 *         description: Email verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: "Account verified successfully. Please select your profession." }
 *                 data: { type: object, properties: { registrationStep: { type: integer, example: 2 } } }
 *       400:
 *         description: Invalid or expired OTP
 */
router.post('/verify-otp', authController.verifyOTP);

/**
 * @swagger
 * /api/professional/profession:
 *   patch:
 *     summary: Step 3 - Select Profession
 *     description: Set the professional's category (OFFICER, RATINGS_AND_CREW, etc.).
 *     tags: [Professional]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [professionalId, profession]
 *             properties:
 *               professionalId: { type: string, format: uuid }
 *               profession:
 *                 type: string
 *                 enum: [OFFICER, RATINGS_AND_CREW, CATERING_AND_MEDICAL]
 *     responses:
 *       200:
 *         description: Profession set successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data: { type: object, properties: { registrationStep: { type: integer, example: 3 } } }
 */
router.patch('/profession', authController.setProfession);

/**
 * @swagger
 * /api/professional/upload-photo:
 *   post:
 *     summary: Step 4 - Upload Profile Photo
 *     description: Upload a profile photo for the professional.
 *     tags: [Professional]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [professionalId, photo]
 *             properties:
 *               professionalId: { type: string, format: uuid }
 *               photo: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Photo uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     url: { type: string, format: url }
 *                     registrationStep: { type: integer, example: 4 }
 */
router.post(
  '/upload-photo',
  upload.single('photo'),
  authController.uploadProfilePhoto,
);

/**
 * @swagger
 * /api/professional/role:
 *   patch:
 *     summary: Step 5 - Select Role (Subcategory)
 *     description: Set the specific role (e.g., Deck Officer). Registration complete, JWT issued.
 *     tags: [Professional]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [professionalId, subcategory]
 *             properties:
 *               professionalId: { type: string, format: uuid }
 *               subcategory: { type: string, example: "Deck Officer" }
 *     responses:
 *       200:
 *         description: Role set. Registration complete.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 token: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     user: { $ref: '#/components/schemas/Professional' }
 *                     registrationStep: { type: integer, example: 5 }
 */
router.patch('/role', authController.setRole);

/**
 * @swagger
 * /api/professional/complete-profile:
 *   post:
 *     summary: Step 6 - Complete Professional Profile (Legacy/Catch-all)
 *     description: Finalize the profile by adding profession and bio. This activates the account for full platform access.
 *     tags: [Professional]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [professionalId, profession, idPassportUrl]
 *             properties:
 *               professionalId: { type: string, format: uuid }
 *               profession:
 *                 type: string
 *                 enum: [OFFICER, RATINGS_AND_CREW, CATERING_AND_MEDICAL]
 *               idPassportUrl: { type: string, format: url }
 *               bio: { type: string }
 *     responses:
 *       200:
 *         description: Profile completed. User is now logged in.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 token: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     user: { $ref: '#/components/schemas/Professional' }
 */
router.post('/complete-profile', authController.completeProfile);

/**
 * @swagger
 * /api/professional/login:
 *   post:
 *     summary: Professional Login
 *     description: Authenticate and receive a JWT. Only verified professionals can login.
 *     tags: [Professional]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: "john.doe@example.com" }
 *               password: { type: string, format: password }
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 token: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     user: { $ref: '#/components/schemas/Professional' }
 *       401:
 *         description: Invalid credentials or unverified account
 */
router.post('/login', authController.login);
/**
 * @swagger
 * /api/professional/resend-otp:
 *   post:
 *     summary: Resend OTP code
 *     tags: [Professional]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email, example: "john.doe@example.com" }
 *     responses:
 *       200:
 *         description: OTP resent successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: "OTP resent to your email." }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.post('/resend-otp', authController.resendOTP);

/**
 * @swagger
 * /api/professional/forgot-password:
 *   post:
 *     summary: Request a password reset link
 *     tags: [Professional]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email, example: "john.doe@example.com" }
 *     responses:
 *       200:
 *         description: Reset link sent to email.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: "Password reset link sent to your email." }
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.post('/forgot-password', authController.forgotPassword);

/**
 * @swagger
 * /api/professional/reset-password/{token}:
 *   patch:
 *     summary: Reset password using token
 *     tags: [Professional]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: The reset token received via email
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password: { type: string, minLength: 6, example: "NewPassword123!" }
 *     responses:
 *       200:
 *         description: Password reset successful.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string, example: "Your password has been reset successfully." }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */
router.patch('/reset-password/:token', authController.resetPassword);

/**
 * @swagger
 * /api/professional/update-password:
 *   patch:
 *     summary: Update password (authenticated)
 *     tags: [Professional]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [oldPassword, newPassword]
 *             properties:
 *               oldPassword: { type: string }
 *               newPassword: { type: string, minLength: 6 }
 *     responses:
 *       200:
 *         description: Password updated successfully.
 *       401:
 *         description: Incorrect old password.
 */
router.patch('/update-password', protect, authController.updatePassword);

/**
 * @swagger
 * /api/professional/documents/upload:
 *   post:
 *     summary: Upload a document to wallet
 *     tags: [Professional Documents]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [document, category, name]
 *             properties:
 *               document: { type: string, format: binary }
 *               category:
 *                 type: string
 *                 enum: [LICENSES_ENDORSEMENTS, MEDICAL_CERTIFICATES, TRAVEL_DOCUMENTS, SEAMANS_BOOK, ACADEMIC_QUALIFICATIONS, MISC_COMPANY_LETTERS, RECENT_APPRAISALS]
 *               name: { type: string }
 *               number: { type: string }
 *               issuingCountry: { type: string }
 *               issueDate: { type: string, format: date-time }
 *               expiryDate: { type: string, format: date-time }
 *     responses:
 *       201:
 *         description: Document uploaded successfully. Returns extraction results.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     document: { $ref: '#/components/schemas/ProfessionalDocument' }
 *                     ocrData: { $ref: '#/components/schemas/OCRData' }
 *                     matchStatus:
 *                       type: object
 *                       properties:
 *                         isFullyMatched: { type: boolean }
 *                         details: { type: object }
 */
/**
 * @swagger
 * /api/professional/upload-cv:
 *   post:
 *     summary: Upload CV/Resume file
 *     description: Upload a PDF/Image of the professional's resume. Updates the profile cvUrl.
 *     tags: [Professional]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [document]
 *             properties:
 *               document: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: CV uploaded successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     url: { type: string, format: url }
 */
router.post(
  '/upload-cv',
  protect,
  upload.single('document'),
  documentController.uploadResume,
);

/**
 * @swagger
 * /api/professional/upload-cover-letter:
 *   post:
 *     summary: Upload Cover Letter file
 *     description: Upload a PDF/Image of the professional's cover letter for a job application.
 *     tags: [Professional]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [document]
 *             properties:
 *               document: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Cover letter uploaded successfully.
 */
router.post(
  '/upload-cover-letter',
  protect,
  upload.single('document'),
  documentController.uploadCoverLetter,
);

/**
 * @swagger
 * /api/professional/resumes:
 *   get:
 *     summary: Get all uploaded resumes
 *     description: Retrieve a list of all resumes uploaded by the professional, sorted by most recent.
 *     tags: [Professional]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of resumes retrieved.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 results: { type: integer }
 *                 data:
 *                   type: object
 *                   properties:
 *                     resumes:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/ProfessionalDocument' }
 */
router.get('/resumes', protect, documentController.getMyResumes);

/**
 * @swagger
 * /api/professional/documents/upload:
 *   post:
 *     summary: KYC Step 1 - Upload Identity Document
 *     tags: [Professional Documents]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [document, category, name]
 *             properties:
 *               document: { type: string, format: binary }
 *               category:
 *                 type: string
 *                 enum: [LICENSES_ENDORSEMENTS, MEDICAL_CERTIFICATES, TRAVEL_DOCUMENTS, SEAMANS_BOOK, ACADEMIC_QUALIFICATIONS, MISC_COMPANY_LETTERS, RECENT_APPRAISALS]
 *               name: { type: string }
 *               number: { type: string }
 *               issuingCountry: { type: string }
 *               issueDate: { type: string, format: date-time }
 *               expiryDate: { type: string, format: date-time }
 *     responses:
 *       201:
 *         description: Document uploaded successfully. Returns extraction results.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     document: { $ref: '#/components/schemas/ProfessionalDocument' }
 *                     ocrData: { $ref: '#/components/schemas/OCRData' }
 *                     matchStatus:
 *                       type: object
 *                       description: "Contains comparison logic matching user input against extracted OCR data."
 *                       properties:
 *                         isFullyMatched: { type: boolean }
 *                         details: { type: object }
 */
router.post(
  '/documents/upload',
  protect,
  upload.single('document'),
  documentController.uploadDocument,
);

/**
 * @swagger
 * /api/professional/documents:
 *   get:
 *     summary: Get all documents (optional category filter)
 *     tags: [Professional Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of documents.
 */
router.get('/documents', protect, documentController.getDocuments);

/**
 * @swagger
 * /api/professional/documents/{id}:
 *   patch:
 *     summary: Update a document
 *     tags: [Professional Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               category: { type: string }
 *               number: { type: string }
 *               issuingCountry: { type: string }
 *               issueDate: { type: string, format: date-time }
 *               expiryDate: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Document updated successfully.
 */
router.patch('/documents/:id', protect, documentController.updateDocument);

/**
 * @swagger
 * /api/professional/documents/{id}:
 *   delete:
 *     summary: Delete a document
 *     tags: [Professional Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Document deleted successfully.
 */
router.delete('/documents/:id', protect, documentController.deleteDocument);

/**
 * @swagger
 * /api/professional/kyc/upload-document-front:
 *   post:
 *     summary: Professional KYC Step 1a - Upload Document Front Side
 *     description: Upload the front side of the identity document.
 *     tags: [Professional KYC]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [professionalId, documentFront]
 *             properties:
 *               professionalId: { type: string }
 *               documentFront: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Front side uploaded successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 url: { type: string }
 */
router.post(
  '/kyc/upload-document-front',
  protect,
  upload.single('documentFront'),
  kycController.uploadKYCDocumentFront,
);

/**
 * @swagger
 * /api/professional/kyc/upload-document-back:
 *   post:
 *     summary: Professional KYC Step 1b - Upload Document Back Side
 *     description: Upload the back side of the identity document.
 *     tags: [Professional KYC]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [professionalId, documentBack]
 *             properties:
 *               professionalId: { type: string }
 *               documentBack: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Back side uploaded successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 url: { type: string }
 */
router.post(
  '/kyc/upload-document-back',
  protect,
  upload.single('documentBack'),
  kycController.uploadKYCDocumentBack,
);

/**
 * @swagger
 * /api/professional/kyc/submit:
 *   post:
 *     summary: Professional KYC Step 2 - Submit Personal Details & Document URL
 *     tags: [Professional KYC]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [professionalId, firstName, lastName, dateOfBirth, documentType, documentNumber, expiryDate, issueCountry]
 *             properties:
 *               professionalId: { type: string }
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               dateOfBirth: { type: string, format: date }
 *               documentType: { type: string, enum: [PASSPORT, DRIVING_LICENSE, NATIONAL_ID, RESIDENCE_PERMIT] }
 *               documentNumber: { type: string }
 *               expiryDate: { type: string, format: date }
 *               issueCountry: { type: string }
 *               documentUrl: { type: string, description: "Legacy combined URL" }
 *               documentFrontUrl: { type: string, description: "URL for the front side of the document" }
 *               documentBackUrl: { type: string, description: "URL for the back side of the document" }
 *     responses:
 *       200:
 *         description: KYC details submitted. Please upload a selfie next.
 */
router.post('/kyc/submit', protect, kycController.submitKYC);

/**
 * @swagger
 * /api/professional/kyc/upload-selfie:
 *   post:
 *     summary: Professional KYC Step 3 - Upload Selfie
 *     tags: [Professional KYC]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [professionalId, selfie]
 *             properties:
 *               professionalId: { type: string }
 *               selfie: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Selfie uploaded and linked successfully.
 */
router.post(
  '/kyc/upload-selfie',
  protect,
  upload.single('selfie'),
  kycController.uploadKYCSelfie,
);

/**
 * @swagger
 * /api/professional/courses:
 *   get:
 *     summary: Browse maritime courses
 *     tags: [Professional Courses]
 *     security:
 *       - bearerAuth: []
 */
router.get('/courses', protect, courseController.getCourses);

/**
 * @swagger
 * /api/professional/courses/{courseId}/sessions:
 *   get:
 *     summary: Get available sessions for a course
 *     tags: [Professional Courses]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/courses/:courseId/sessions',
  protect,
  courseController.getCourseSessions,
);

// --- User Support Routes ---
import * as userSupportController from '../controllers/userSupportController.js';

/**
 * @swagger
 * /api/professional/support/cases:
 *   post:
 *     summary: Step 1 - Create support case
 *     description: Submit a new support request or inquiry.
 *     tags: [Professional Support]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subject, description, category]
 *             properties:
 *               subject: { type: string, example: "Booking Issue" }
 *               description: { type: string, example: "I cannot complete my payment for..." }
 *               category: { type: string, example: "PAYMENTS" }
 *               priority:
 *                 type: string
 *                 enum: [HIGH, MEDIUM, LOW]
 *                 default: MEDIUM
 *     responses:
 *       201:
 *         description: Support case created successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     case: { $ref: '#/components/schemas/SupportCase' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/support/cases', protect, userSupportController.createCase);

/**
 * @swagger
 * /api/professional/support/cases:
 *   get:
 *     summary: Get my support cases
 *     description: Retrieve a paginated list of support cases submitted by the professional.
 *     tags: [Professional Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: List of support cases.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 results: { type: integer, example: 2 }
 *                 data:
 *                   type: object
 *                   properties:
 *                     cases:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/SupportCase' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/support/cases', protect, userSupportController.getMyCases);

/**
 * @swagger
 * /api/professional/support/cases/{id}:
 *   get:
 *     summary: Get case details and chat history
 *     description: Retrieve full details for a specific support case and its conversation history.
 *     tags: [Professional Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Detailed case information with notes.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     case: { $ref: '#/components/schemas/SupportCase' }
 *                     notes:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/SupportNote' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/support/cases/:id', protect, userSupportController.getCaseDetails);

/**
 * @swagger
 * /api/professional/support/cases/{id}/reply:
 *   post:
 *     summary: Reply to a support case
 *     description: Send a new message to an active support case.
 *     tags: [Professional Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string, example: "Yes, I have already checked..." }
 *     responses:
 *       201:
 *         description: Reply added successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     note: { $ref: '#/components/schemas/SupportNote' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.post(
  '/support/cases/:id/reply',
  protect,
  userSupportController.addReply,
);

// --- JOB FLOW ROUTES ---
import * as jobController from '../controllers/jobController.js';
import * as applicationController from '../controllers/applicationController.js';
import * as professionalJobController from '../controllers/professionalJobController.js';

/**
 * @swagger
 * /api/professional/jobs:
 *   get:
 *     summary: Browse all jobs
 *     description: Retrieve a paginated list of all active maritime job postings.
 *     tags: [Professional Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: category
 *         schema: { type: string, enum: [OFFICER, RATINGS_AND_CREW, CATERING_AND_MEDICAL] }
 *     responses:
 *       200:
 *         description: List of available jobs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 results: { type: integer }
 *                 data:
 *                   type: object
 *                   properties:
 *                     jobs:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Job' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/jobs', protect, jobController.getJobs);

/**
 * @swagger
 * /api/professional/jobs/saved:
 *   get:
 *     summary: Get my saved jobs
 *     tags: [Professional Jobs]
 *     security:
 *       - bearerAuth: []
 */
router.get('/jobs/saved', protect, professionalJobController.getSavedJobs);

/**
 * @swagger
 * /api/professional/jobs/{id}:
 *   get:
 *     summary: View job details
 *     description: Retrieve full details for a specific maritime job posting.
 *     tags: [Professional Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Full job details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     job: { $ref: '#/components/schemas/Job' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/jobs/:id', protect, jobController.getJobById);

/**
 * @swagger
 * /api/professional/jobs/{id}/save:
 *   post:
 *     summary: Toggle save/bookmark job
 *     tags: [Professional Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Job ID
 */
router.post('/jobs/:id/save', protect, professionalJobController.toggleSaveJob);

/**
 * @swagger
 * /api/professional/jobs/{id}/apply:
 *   post:
 *     summary: Apply to a job
 *     description: Submit an application for a maritime job posting.
 *     tags: [Professional Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               coverLetter: { type: string, example: "I am interested in this position..." }
 *               coverLetterUrl: { type: string, format: url, description: "Optional. URL of the uploaded cover letter document." }
 *               cvUrl: { type: string, format: url, description: "Optional. URL of the resume from a previous upload. If omitted, uses the profile's current CV." }
 *               documentIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *                 description: "Optional. Array of Document IDs from the Professional's wallet to attach."
 *     responses:
 *       201:
 *         description: Application submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data:
 *                   type: object
 *                   properties:
 *                     application: { $ref: '#/components/schemas/JobApplication' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       400:
 *         description: Already applied or validation error
 */
router.post('/jobs/:id/apply', protect, applicationController.applyToJob);

/**
 * @swagger
 * /api/professional/jobs/{id}/application-status:
 *   get:
 *     summary: Check if applied to job
 *     tags: [Professional Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Job ID
 */
router.get(
  '/jobs/:id/application-status',
  protect,
  applicationController.getMyApplicationStatus,
);

/**
 * @swagger
 * /api/professional/applications:
 *   get:
 *     summary: Get my applications
 *     description: Retrieve all job applications submitted by the logged-in professional.
 *     tags: [Professional Applications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of submitted applications
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 results: { type: integer, example: 3 }
 *                 data:
 *                   type: object
 *                   properties:
 *                     applications:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/JobApplication' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/applications', protect, applicationController.getMyApplications);

/**
 * @swagger
 * /api/professional/applications/{id}:
 *   get:
 *     summary: Get application details
 *     tags: [Professional Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Application ID
 */
router.get(
  '/applications/:id',
  protect,
  applicationController.getApplicationDetails,
);

/**
 * @swagger
 * /api/professional/applications/{id}:
 *   delete:
 *     summary: Withdraw application
 *     tags: [Professional Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Application ID
 */
router.delete(
  '/applications/:id',
  protect,
  applicationController.withdrawApplication,
);

export default router;
