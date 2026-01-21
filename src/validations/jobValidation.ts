import { z } from 'zod';

export const createJobSchema = z.object({
  title: z.string().min(3).max(100),
  location: z.string().min(2).max(100),
  category: z.string().min(2).max(50),
  contractType: z.string().min(2).max(50),
  salary: z.string().min(1).max(50),
  description: z.string().min(10),
});

export const createCourseSchema = z.object({
  title: z.string().min(3).max(100),
  location: z.string().min(2).max(100),
  category: z.string().min(2).max(50),
  contractType: z.string().min(2).max(50), // Consistent with user request
  description: z.string().min(10),
});
