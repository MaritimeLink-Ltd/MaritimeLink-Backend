import { Router } from 'express';
import * as resumeController from '../controllers/professionalResumeController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = Router();

// All resume routes are protected
router.use(protect);

/**
 * @swagger
 * tags:
 *   name: Resume
 *   description: Professional resume management
 */

/**
 * @swagger
 * /api/professional/resume/personal-info:
 *   patch:
 *     summary: Step 6 - Personal Information
 *     description: Update professional's personal details in resume.
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firstName, lastName, dateOfBirth, address, city, state, postcode, country, phoneCode, phoneNumber, emailAddress]
 *             properties:
 *               firstName: { type: string }
 *               middleName: { type: string }
 *               lastName: { type: string }
 *               dateOfBirth: { type: string, format: date }
 *               address: { type: string }
 *               city: { type: string }
 *               state: { type: string }
 *               postcode: { type: string }
 *               country: { type: string }
 *               phoneCode: { type: string }
 *               phoneNumber: { type: string }
 *               emailAddress: { type: string, format: email }
 *     responses:
 *       200:
 *         description: Personal info updated
 */
router.patch('/personal-info', resumeController.updatePersonalInfo);

/**
 * @swagger
 * /api/professional/resume/summary:
 *   patch:
 *     summary: Step 7 - Professional Summary
 *     description: Update professional's summary/bio in resume.
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [summary]
 *             properties:
 *               summary: { type: string, minLength: 20 }
 *     responses:
 *       200:
 *         description: Summary updated
 */
router.patch('/summary', resumeController.updateSummary);

/**
 * @swagger
 * /api/professional/resume/skills:
 *   post:
 *     summary: Step 8 - Key Skills
 *     description: Add a new skill to professional's resume.
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [skillName, rating]
 *             properties:
 *               skillName: { type: string }
 *               rating: { type: integer, minimum: 1, maximum: 5 }
 *     responses:
 *       201:
 *         description: Skill added
 */
router.post('/skills', resumeController.addSkill);

/**
 * @swagger
 * /api/professional/resume/skills/{id}:
 *   delete:
 *     summary: Delete a skill entry
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Skill deleted
 *       404:
 *         description: Skill not found
 */
router.delete('/skills/:id', resumeController.deleteSkill);

/**
 * @swagger
 * /api/professional/resume/licenses:
 *   post:
 *     summary: Step 9 - Licenses & Endorsements
 *     description: Add a new license or endorsement to professional's resume.
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               number: { type: string }
 *               country: { type: string }
 *               issueDate: { type: string, format: date }
 *               expiryDate: { type: string, format: date }
 *               isEndorsement: { type: boolean, default: false }
 *               isCertificate: { type: boolean, default: false }
 *     responses:
 *       201:
 *         description: License added
 */
router.post('/licenses', resumeController.addLicense);

/**
 * @swagger
 * /api/professional/resume/licenses/{id}:
 *   delete:
 *     summary: Delete a license, endorsement, or certificate entry
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: License deleted
 *       404:
 *         description: License not found
 */
router.delete('/licenses/:id', resumeController.deleteLicense);

/**
 * @swagger
 * /api/professional/resume/sea-service:
 *   post:
 *     summary: Step 10 - Sea Service Log
 *     description: Add a new sea service entry.
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [companyName, role, vesselName, joiningDate]
 *             properties:
 *               companyName: { type: string }
 *               role: { type: string }
 *               vesselName: { type: string }
 *               imoNumber: { type: string }
 *               flag: { type: string }
 *               vesselType: { type: string }
 *               dwt: { type: string }
 *               meType: { type: string }
 *               kwtType: { type: string }
 *               joiningDate: { type: string, format: date }
 *               tillDate: { type: string, format: date }
 *     responses:
 *       201:
 *         description: Sea service log added
 */
router.post('/sea-service', resumeController.addSeaService);

/**
 * @swagger
 * /api/professional/resume/sea-service/{id}:
 *   delete:
 *     summary: Delete a sea service log entry
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Sea service log deleted
 *       404:
 *         description: Sea service entry not found
 */
router.delete('/sea-service/:id', resumeController.deleteSeaService);

/**
 * @swagger
 * /api/professional/resume/education:
 *   post:
 *     summary: Step 11a - Academic Qualifications
 *     description: Add an education entry.
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [qualificationName, institution, startDate]
 *             properties:
 *               qualificationName: { type: string }
 *               institution: { type: string }
 *               city: { type: string }
 *               country: { type: string }
 *               grade: { type: string }
 *               startDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *     responses:
 *       201:
 *         description: Education added
 */
router.post('/education', resumeController.addEducation);

/**
 * @swagger
 * /api/professional/resume/education/{id}:
 *   delete:
 *     summary: Delete an academic qualification entry
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Education deleted
 *       404:
 *         description: Education entry not found
 */
router.delete('/education/:id', resumeController.deleteEducation);

/**
 * @swagger
 * /api/professional/resume/stcw-certificates:
 *   post:
 *     summary: Step 11b - STCW Certificates
 *     description: Add an STCW certificate.
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [qualification]
 *             properties:
 *               qualification: { type: string }
 *               certificateNumber: { type: string }
 *               issuingCountry: { type: string }
 *               issueDate: { type: string, format: date }
 *               expiryDate: { type: string, format: date }
 *     responses:
 *       201:
 *         description: STCW Certificate added
 */
router.post('/stcw-certificates', resumeController.addSTCWCertificate);

/**
 * @swagger
 * /api/professional/resume/stcw-certificates/{id}:
 *   delete:
 *     summary: Delete an STCW certificate entry
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: STCW Certificate deleted
 *       404:
 *         description: STCW Certificate not found
 */
router.delete('/stcw-certificates/:id', resumeController.deleteSTCWCertificate);

/**
 * @swagger
 * /api/professional/resume/medical-travel-documents:
 *   post:
 *     summary: Step 12 - Medical & Travel Documents
 *     description: Add a medical or travel document.
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, type]
 *             properties:
 *               name: { type: string }
 *               documentNumber: { type: string }
 *               issuingCountry: { type: string }
 *               city: { type: string }
 *               institutionCountry: { type: string }
 *               issueDate: { type: string, format: date }
 *               expiryDate: { type: string, format: date }
 *               type: { type: string, enum: [MEDICAL, TRAVEL] }
 *     responses:
 *       201:
 *         description: Document added
 */
router.post(
  '/medical-travel-documents',
  resumeController.addMedicalTravelDocument,
);

/**
 * @swagger
 * /api/professional/resume/medical-travel-documents/{id}:
 *   delete:
 *     summary: Delete a medical or travel document entry
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Document deleted
 *       404:
 *         description: Document not found
 */
router.delete(
  '/medical-travel-documents/:id',
  resumeController.deleteMedicalTravelDocument,
);

/**
 * @swagger
 * /api/professional/resume/biometrics:
 *   patch:
 *     summary: Step 13 - Biometrics
 *     description: Update biometrics in resume.
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [gender, height, weight]
 *             properties:
 *               gender: { type: string, enum: [MALE, FEMALE, OTHER] }
 *               height: { type: number, example: 180 }
 *               weight: { type: number, example: 75 }
 *               bmi: { type: number }
 *               eyeColor: { type: string }
 *               overallSize: { type: string }
 *               shoeSize: { type: string }
 *     responses:
 *       200:
 *         description: Biometrics updated
 */
router.patch('/biometrics', resumeController.updateBiometrics);

/**
 * @swagger
 * /api/professional/resume/next-of-kin:
 *   post:
 *     summary: Step 14 - Next of Kin
 *     description: Add a next of kin entry.
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, relationship, countryCode, phoneNumber]
 *             properties:
 *               name: { type: string }
 *               relationship: { type: string }
 *               countryCode: { type: string }
 *               phoneNumber: { type: string }
 *               email: { type: string, format: email }
 *     responses:
 *       201:
 *         description: Next of kin added
 */
router.post('/next-of-kin', resumeController.addNextOfKin);

/**
 * @swagger
 * /api/professional/resume/next-of-kin/{id}:
 *   delete:
 *     summary: Delete a next of kin entry
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Next of kin deleted
 *       404:
 *         description: Next of kin entry not found
 */
router.delete('/next-of-kin/:id', resumeController.deleteNextOfKin);

/**
 * @swagger
 * /api/professional/resume/referees:
 *   post:
 *     summary: Step 15 - Referees
 *     description: Add a referee entry.
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, position, companyName, countryCode, phoneNumber]
 *             properties:
 *               name: { type: string }
 *               position: { type: string }
 *               companyName: { type: string }
 *               countryCode: { type: string }
 *               phoneNumber: { type: string }
 *               email: { type: string, format: email }
 *     responses:
 *       201:
 *         description: Referee added
 */
router.post('/referees', resumeController.addReferee);

/**
 * @swagger
 * /api/professional/resume/referees/{id}:
 *   delete:
 *     summary: Delete a referee entry
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Referee deleted
 *       404:
 *         description: Referee not found
 */
router.delete('/referees/:id', resumeController.deleteReferee);

/**
 * @swagger
 * /api/professional/resume:
 *   get:
 *     summary: Get current professional's full resume
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Resume data retrieved, including professional's name details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: "success" }
 *                 data:
 *                   type: object
 *                   properties:
 *                     resume:
 *                       type: object
 *                       properties:
 *                         firstName: { type: string, example: "John" }
 *                         middleName: { type: string, example: "Lee" }
 *                         lastName: { type: string, example: "Doe" }
 *                         id: { type: string, format: "uuid" }
 */
router.get('/', resumeController.getResume);

/**
 * @swagger
 * /api/professional/resume:
 *   post:
 *     summary: Create or update full professional resume (Bulk)
 *     description: |
 *       Allows full replacement of the professional resume.
 *       List-based fields (skills, licenses, certificates, etc.) will be completely replaced by the provided arrays.
 *     tags: [Resume]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ResumeBulkUpdate'
 *     responses:
 *       200:
 *         description: Resume updated successfully
 */
router.post('/', resumeController.upsertResume);

/**
 * @swagger
 * /api/professional/resume:
 *   put:
 *     summary: Update full professional resume (Bulk)
 *     tags: [Resume]
 */
router.put('/', resumeController.upsertResume);

/**
 * @swagger
 * /api/professional/resume:
 *   delete:
 *     summary: Delete professional resume
 *     tags: [Resume]
 */
router.delete('/', resumeController.deleteResume);

export default router;
