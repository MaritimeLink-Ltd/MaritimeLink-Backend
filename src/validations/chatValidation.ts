import { z } from 'zod';

export const createConversationSchema = z.object({
  recipientId: z.string().uuid(),
});

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(5000),
});

export const getMessagesSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.preprocess(
    (val) => parseInt(val as string, 10) || 20,
    z.number().min(1).max(100),
  ),
});
