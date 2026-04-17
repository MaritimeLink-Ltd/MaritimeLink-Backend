import { z } from 'zod';

const DocumentCategoryEnum = z.enum([
  'LICENSES_ENDORSEMENTS',
  'MEDICAL_CERTIFICATES',
  'TRAVEL_DOCUMENTS',
  'SEAMANS_BOOK',
  'ACADEMIC_QUALIFICATIONS',
  'MISC_COMPANY_LETTERS',
  'RECENT_APPRAISALS',
]);

const documentDateSchema = z
  .string()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: 'Invalid date',
  });

export const uploadDocumentSchema = z.object({
  category: DocumentCategoryEnum,
  name: z.string().optional(),
  number: z.string().optional(),
  issuingCountry: z.string().optional(),
  issueDate: documentDateSchema.optional().or(z.literal('')),
  expiryDate: documentDateSchema.optional().or(z.literal('')),
});

export const updateDocumentSchema = z.object({
  category: DocumentCategoryEnum.optional(),
  name: z.string().min(1, 'Document name is required').optional(),
  number: z.string().optional(),
  issuingCountry: z.string().optional(),
  issueDate: documentDateSchema.optional().or(z.literal('')),
  expiryDate: documentDateSchema.optional().or(z.literal('')),
});
