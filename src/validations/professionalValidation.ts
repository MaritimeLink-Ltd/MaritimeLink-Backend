import { z } from 'zod';

export const registerSchema = z.object({
  fullname: z.string().min(3).max(100),
  email: z.string().email(),
  password: z.string().min(8),
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
