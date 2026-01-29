import { z } from 'zod';

export const createSessionSchema = z.object({
  startDate: z.string().datetime({ message: 'Invalid start date format' }),
  endDate: z.string().datetime({ message: 'Invalid end date format' }),
  startTime: z
    .string()
    .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
      message: 'Invalid start time format (HH:mm)',
    }),
  endTime: z
    .string()
    .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
      message: 'Invalid end time format (HH:mm)',
    }),
  location: z.string().min(1, { message: 'Location is required' }),
  instructor: z.string().min(1, { message: 'Instructor is required' }),
  totalSeats: z
    .number()
    .int()
    .positive({ message: 'Total seats must be a positive integer' }),
});

export const updateSessionSchema = createSessionSchema.partial();
