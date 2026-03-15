import { z } from 'zod';

export const registerSchema = z.object({
  firstName: z.string().min(2).max(50),
  middleName: z.string().max(50).optional(),
  lastName: z.string().min(2).max(50),
  email: z.string().email(),
  password: z.string().min(8),
});

export const setProfessionSchema = z.object({
  professionalId: z.string().uuid(),
  profession: z.enum(['OFFICER', 'RATINGS_AND_CREW', 'CATERING_AND_MEDICAL']),
});

export const setRoleSchema = z.object({
  professionalId: z.string().uuid(),
  subcategory: z.string().min(2).max(100),
});

export const completeProfileSchema = z.object({
  professionalId: z.string().uuid(),
  profession: z.enum(['OFFICER', 'RATINGS_AND_CREW', 'CATERING_AND_MEDICAL']),
  bio: z.string().min(10).max(1000).optional(),
  idPassportUrl: z.string().url(),
});

export const updateProfessionalSchema = completeProfileSchema
  .partial()
  .omit({ professionalId: true });
