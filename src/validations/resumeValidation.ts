import { z } from 'zod';

const dateSchema = z.preprocess((arg) => {
  if (typeof arg === 'string' || arg instanceof Date) return new Date(arg);
}, z.date());

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
        skillName: z.string(),
        rating: z.number().min(0).max(10).optional(),
      }),
    )
    .optional(),

  licenses: z
    .array(
      z.object({
        name: z.string(),
        number: z.string().optional(),
        country: z.string().optional(),
        issueDate: dateSchema.optional(),
        expiryDate: dateSchema.optional(),
      }),
    )
    .optional(),

  seaService: z
    .array(
      z.object({
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
        qualificationName: z.string(),
        institution: z.string().optional(),
        grade: z.string().optional(),
        startDate: dateSchema.optional(),
        endDate: dateSchema.optional(),
      }),
    )
    .optional(),

  stcwCertificates: z
    .array(
      z.object({
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
        name: z.string(),
        certificateNumber: z.string().optional(),
        issuingCountry: z.string().optional(),
        issueDate: dateSchema.optional(),
        expiryDate: dateSchema.optional(),
      }),
    )
    .optional(),

  travelDocuments: z
    .array(
      z.object({
        name: z.string(),
        documentNumber: z.string().optional(),
        issuingCountry: z.string().optional(),
        issueDate: dateSchema.optional(),
        expiryDate: dateSchema.optional(),
      }),
    )
    .optional(),

  nextOfKin: z
    .array(
      z.object({
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
        name: z.string(),
        position: z.string().optional(),
        countryCode: z.string().optional(),
        phoneNumber: z.string().optional(),
        email: z.string().email().optional(),
      }),
    )
    .optional(),
});
