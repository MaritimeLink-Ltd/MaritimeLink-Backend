import { z } from 'zod';

/**
 * Admin bulk-announcement request. `recruiterIds` covers both Recruiters and
 * Training Providers — they're the same `Recruiter` table, distinguished only
 * by `role`, so the frontend picker sends whichever rows it selected from
 * either tab into this one array.
 */
export const sendAnnouncementSchema = z
  .object({
    subject: z.string().trim().min(3).max(200),
    message: z.string().trim().min(3).max(5000),
    professionalIds: z
      .array(z.string().uuid())
      .max(5000)
      .optional()
      .default([]),
    recruiterIds: z.array(z.string().uuid()).max(5000).optional().default([]),
  })
  .refine(
    (data) => data.professionalIds.length + data.recruiterIds.length > 0,
    { message: 'Select at least one recipient', path: ['professionalIds'] },
  );
