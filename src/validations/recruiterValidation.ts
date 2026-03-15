import { z } from 'zod';

export const agentRegisterSchema = z
  .object({
    role: z.enum(['RECRUITMENT_AGENT', 'TRAINING_AGENT']),
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

export const setPersonalInfoSchema = z.object({
  recruiterId: z.string().uuid(),
  firstName: z.string().min(1, 'First name is required'),
  middleName: z.string().optional(),
  lastName: z.string().min(1, 'Last name is required'),
  phoneCode: z.string().min(1, 'Phone code is required'), // e.g., +92
  phoneNumber: z.string().min(10, 'Invalid phone number'),
  personalRole: z.string().min(1, 'Role is required'),
  otherRole: z.string().optional(),
});

export const setCompanyDetailsSchema = z.object({
  recruiterId: z.string().uuid(),
  organizationName: z.string().min(1, 'Company name is required'),
  address: z.string().min(1, 'Company address is required'),
  companyCity: z.string().min(1, 'City is required'),
  companyState: z.string().min(1, 'State is required'),
  companyZip: z.string().min(1, 'ZIP code is required'),
  companyCountry: z.string().min(1, 'Country is required'),
  website: z.string().url('Invalid website URL').optional().or(z.literal('')),
  companyLinkedIn: z
    .string()
    .url('Invalid LinkedIn URL')
    .optional()
    .or(z.literal('')),
});

export const setComplianceSchema = z.object({
  recruiterId: z.string().uuid(),
  isAuthorized: z
    .boolean()
    .refine((val) => val === true, 'You must be authorized'),
  agreedToTerms: z
    .boolean()
    .refine((val) => val === true, 'You must agree to terms'),
  howDidYouHear: z.string().min(1, 'Please let us know how you heard about us'),
});
