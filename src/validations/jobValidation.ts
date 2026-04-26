import { z } from 'zod';

export const createJobSchema = z.object({
  title: z.string().min(3).max(100),
  location: z.string().min(2).max(100),
  category: z.enum(['OFFICER', 'RATINGS_AND_CREW', 'CATERING_AND_MEDICAL']),
  contractType: z.enum(['TEMPORARY', 'CONTRACT', 'PERMANENT']),
  salary: z.string().min(1).max(50),
  description: z.string().min(10),
  status: z.enum(['ACTIVE', 'DRAFT']).optional().default('ACTIVE'),
  closingDate: z
    .string()
    .optional()
    .refine((val) => !val || !isNaN(Date.parse(val)), {
      message: 'Invalid date format',
    }),
});

export const createCourseSchema = z.object({
  title: z.string().min(3).max(100),
  location: z.string().min(2).max(100).optional(),
  category: z.string().min(2).max(50),
  contractType: z.string().min(2).max(50).optional(),
  description: z.string().min(10),
  price: z.number().min(0),
  currency: z.string().min(3).max(3).optional(),
  // New fields
  trainingType: z.string().optional(),
  issuingAuthority: z.string().optional(),
  duration: z.string().optional(),
  courseType: z.enum(['INTERNAL', 'EXTERNAL']).optional().default('INTERNAL'),
  externalUrl: z.string().url().optional(),
  status: z
    .enum(['DRAFT', 'ACTIVE', 'FULL', 'COMPLETED', 'CANCELLED'])
    .optional()
    .default('ACTIVE'),
  capacity: z.number().int().positive().optional(),
  certificationProvided: z.string().max(100).optional(),
  curriculum: z.string().optional(),
  requirements: z.string().optional(),
});

export const createCourseDraftSchema = createCourseSchema.omit({
  status: true,
});

export const updateJobSchema = createJobSchema.partial();
export const updateJobStatusSchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'FILLED', 'EXPIRED', 'REMOVED']),
});
export const updateCourseSchema = createCourseSchema.partial().extend({
  isFlagged: z.boolean().optional(),
  flagReason: z.string().optional(),
  enrolledCount: z.number().int().min(0).optional(),
});

// Booking validation schemas
export const cancelBookingSchema = z.object({
  reason: z.string().min(5).max(500).optional(),
});

export const updateBookingStatusSchema = z.object({
  status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']),
  notes: z.string().max(1000).optional(),
});

export const messageTraineeSchema = z.object({
  message: z.string().min(10).max(2000),
  subject: z.string().min(3).max(200).optional(),
});
