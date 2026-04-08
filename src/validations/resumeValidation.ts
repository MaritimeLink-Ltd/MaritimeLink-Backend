import { z } from 'zod';

const dateSchema = z.preprocess((arg) => {
  if (typeof arg === 'string' || arg instanceof Date) return new Date(arg);
}, z.date());

export const personalInfoStepSchema = z.object({
  firstName: z.string().min(2).max(50),
  middleName: z.string().max(50).optional(),
  lastName: z.string().min(2).max(50),
  dateOfBirth: dateSchema,
  address: z.string().min(5),
  city: z.string().min(2),
  state: z.string().min(2),
  postcode: z.string().min(2),
  country: z.string().min(2),
  phoneCode: z.string(),
  phoneNumber: z.string().min(5),
  emailAddress: z.string().email(),
});

export const summaryStepSchema = z.object({
  summary: z.string().min(20).max(2000),
});

export const skillStepSchema = z.object({
  skillName: z.string().min(2),
  rating: z.number().min(1).max(5),
});

export const licenseStepSchema = z.object({
  name: z.string().min(2),
  number: z.string().optional(),
  country: z.string().optional(),
  issueDate: dateSchema.optional(),
  expiryDate: dateSchema.optional(),
  isEndorsement: z.boolean().optional(),
  isCertificate: z.boolean().optional(),
});

export const seaServiceStepSchema = z.object({
  companyName: z.string().min(2),
  role: z.string().min(2),
  vesselName: z.string().min(2),
  imoNumber: z.string().optional(),
  flag: z.string().optional(),
  vesselType: z.string().optional(),
  dwt: z.string().optional(),
  meType: z.string().optional(),
  kwtType: z.string().optional(),
  joiningDate: dateSchema,
  tillDate: dateSchema.optional(),
});

export const educationStepSchema = z.object({
  qualificationName: z.string().min(2),
  institution: z.string().min(2),
  city: z.string().optional(),
  country: z.string().optional(),
  grade: z.string().optional(),
  startDate: dateSchema,
  endDate: dateSchema.optional(),
});

export const stcwCertificateStepSchema = z.object({
  qualification: z.string().min(2),
  certificateNumber: z.string().optional(),
  issuingCountry: z.string().optional(),
  issueDate: dateSchema.optional(),
  expiryDate: dateSchema.optional(),
});

export const medicalTravelStepSchema = z.object({
  name: z.string().min(2),
  documentNumber: z.string().optional(),
  issuingCountry: z.string().optional(),
  city: z.string().optional(),
  institutionCountry: z.string().optional(),
  issueDate: dateSchema.optional(),
  expiryDate: dateSchema.optional(),
  type: z.enum(['MEDICAL', 'TRAVEL']),
});

export const biometricsStepSchema = z.object({
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  height: z.number().positive(),
  weight: z.number().positive(),
  bmi: z.number().positive().optional(),
  eyeColor: z.string().optional(),
  overallSize: z.string().optional(),
  shoeSize: z.string().optional(),
});

export const nextOfKinStepSchema = z.object({
  name: z.string().min(2),
  relationship: z.string().min(2),
  countryCode: z.string(),
  phoneNumber: z.string().min(5),
  email: z.string().email().optional(),
});

export const refereeStepSchema = z.object({
  name: z.string().min(2),
  position: z.string().min(2),
  companyName: z.string().min(2),
  countryCode: z.string(),
  phoneNumber: z.string().min(5),
  email: z.string().email().optional(),
});

export const resumeSchema = z.object({
  category: z
    .enum(['OFFICER', 'RATINGS_AND_CREW', 'CATERING_AND_MEDICAL'])
    .optional(),
  subcategory: z.string().optional(),

  // Personal Info
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postcode: z.string().optional(),
  country: z.string().optional(),
  phoneCode: z.string().optional(),
  phoneNumber: z.string().optional(),
  emailAddress: z.string().email().optional(),
  dateOfBirth: dateSchema.optional(),

  // Summary
  summary: z.string().optional(),

  // Biometrics
  gender: z.string().optional(),
  height: z.number().optional(),
  weight: z.number().optional(),
  bmi: z.number().optional(),
  eyeColor: z.string().optional(),
  overallSize: z.string().optional(),
  shoeSize: z.string().optional(),

  // Nested Lists
  skills: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        skillName: z.string(),
        rating: z.number().min(0).max(10).optional(),
      }),
    )
    .optional(),

  licenses: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string(),
        number: z.string().optional(),
        country: z.string().optional(),
        issueDate: dateSchema.optional(),
        expiryDate: dateSchema.optional(),
        isEndorsement: z.boolean().optional(),
        isCertificate: z.boolean().optional(),
      }),
    )
    .optional(),

  seaService: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        companyName: z.string(),
        role: z.string().optional(),
        vesselName: z.string().optional(),
        imoNumber: z.string().optional(),
        flag: z.string().optional(),
        vesselType: z.string().optional(),
        dwt: z.string().optional(),
        meType: z.string().optional(),
        kwtType: z.string().optional(),
        joiningDate: dateSchema.optional(),
        tillDate: dateSchema.optional(),
      }),
    )
    .optional(),

  education: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        qualificationName: z.string(),
        institution: z.string().optional(),
        city: z.string().optional(),
        country: z.string().optional(),
        grade: z.string().optional(),
        startDate: dateSchema.optional(),
        endDate: dateSchema.optional(),
      }),
    )
    .optional(),

  stcwCertificates: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        qualification: z.string(),
        certificateNumber: z.string().optional(),
        issuingCountry: z.string().optional(),
        issueDate: dateSchema.optional(),
        expiryDate: dateSchema.optional(),
      }),
    )
    .optional(),

  medicalCertificates: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string(),
        certificateNumber: z.string().optional(),
        documentNumber: z.string().optional(),
        issuingCountry: z.string().optional(),
        city: z.string().optional(),
        institutionCountry: z.string().optional(),
        issueDate: dateSchema.optional(),
        expiryDate: dateSchema.optional(),
      }),
    )
    .optional(),

  travelDocuments: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string(),
        documentNumber: z.string().optional(),
        issuingCountry: z.string().optional(),
        city: z.string().optional(),
        institutionCountry: z.string().optional(),
        issueDate: dateSchema.optional(),
        expiryDate: dateSchema.optional(),
      }),
    )
    .optional(),

  nextOfKin: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string(),
        relationship: z.string().optional(),
        countryCode: z.string().optional(),
        phoneNumber: z.string().optional(),
        email: z.string().email().optional(),
      }),
    )
    .optional(),

  referees: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string(),
        position: z.string().optional(),
        countryCode: z.string().optional(),
        phoneNumber: z.string().optional(),
        email: z.string().email().optional(),
      }),
    )
    .optional(),
});
