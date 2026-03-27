import { z } from 'zod';

export const submitKYCSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  dateOfBirth: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: 'Invalid date of birth',
  }),
  documentType: z.enum([
    'PASSPORT',
    'DRIVING_LICENSE',
    'NATIONAL_ID',
    'RESIDENCE_PERMIT',
  ]),
  documentNumber: z.string().min(1, 'Document number is required'),
  expiryDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: 'Invalid expiry date',
  }),
  issueCountry: z.string().min(1, 'Issue country is required'),
  documentUrl: z.string().url('Invalid document URL').optional(),
  documentFrontUrl: z.string().url('Invalid front document URL').optional(),
  documentBackUrl: z.string().url('Invalid back document URL').optional(),
  selfieUrl: z.string().url('Invalid selfie URL').optional(),
});

export type SubmitKYCInput = z.infer<typeof submitKYCSchema>;
