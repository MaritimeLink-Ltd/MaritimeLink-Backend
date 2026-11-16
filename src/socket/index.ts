import { Server as SocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import {
  describeRestriction,
  liftExpiredProfessionalSuspension,
} from '../services/accountModerationService.js';

interface SocketUser {
  id: string;
  userType: 'PROFESSIONAL' | 'RECRUITER' | 'ADMIN';
}

// Track online users
const onlineUsers = new Map<string, Set<string>>(); // userId -> Set of socketIds

declare module 'socket.io' {
  interface Socket {
    user?: SocketUser;
  }
}

export const setupSocket = (server: HttpServer) => {
  const io = new SocketServer(server, {
    cors: {
      origin: '*', // Adjust for production
      methods: ['GET', 'POST'],
    },
  });

  // Authentication Middleware
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth.token ||
        socket.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, env.JWT_SECRET, {
        algorithms: ['HS256'],
      }) as { id: string };

      // Check Professional
      const professional = await prisma.professional.findUnique({
        where: { id: decoded.id },
      });

      if (professional) {
        // Suspended or blocked professionals don't get live chat/alerts, the
        // same as the REST API refuses them.
        const effectiveStatus =
          await liftExpiredProfessionalSuspension(professional);
        if (describeRestriction({ ...professional, status: effectiveStatus })) {
          return next(new Error('Authentication error: Account restricted'));
        }
        socket.user = { id: professional.id, userType: 'PROFESSIONAL' };
        return next();
      }

      // Check Recruiter
      const recruiter = await prisma.recruiter.findUnique({
        where: { id: decoded.id },
      });

      if (recruiter && recruiter.status === 'APPROVED') {
        socket.user = { id: recruiter.id, userType: 'RECRUITER' };
        return next();
      }

      const admin = await prisma.admin.findUnique({
        where: { id: decoded.id },
      });

      if (admin && !admin.disabledAt) {
        socket.user = { id: admin.id, userType: 'ADMIN' };
        return next();
      }

      return next(new Error('Authentication error: Invalid user'));
    } catch {
      return next(new Error('Authentication error: Token invalid'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 New connection: ${socket.id} (User: ${socket.user?.id})`);

    const userId = socket.user?.id;
    if (userId) {
      socket.join(userId); // Join a private room for notification

      // Track online status
      if (!onlineUsers.has(userId)) {
        onlineUsers.set(userId, new Set());
        // No client listens for online/offline broadcasts, and sending every
        // user's id to every connected socket leaked account ids, so the
        // presence map is kept server-side only.
      }
      onlineUsers.get(userId)!.add(socket.id);

      console.log(
        `👤 User ${userId} is online (${onlineUsers.get(userId)!.size} connections)`,
      );
    }

    // Conversations this socket has been confirmed to take part in.
    const verifiedConversations = new Set<string>();

    const isParticipant = async (conversationId: unknown): Promise<boolean> => {
      if (!userId || typeof conversationId !== 'string' || !conversationId) {
        return false;
      }
      if (verifiedConversations.has(conversationId)) return true;
      try {
        const conversation = await prisma.conversation.findUnique({
          where: { id: conversationId },
          select: { professionalId: true, recruiterId: true, adminId: true },
        });
        const allowed =
          !!conversation &&
          (conversation.professionalId === userId ||
            conversation.recruiterId === userId ||
            conversation.adminId === userId);
        if (allowed) verifiedConversations.add(conversationId);
        return allowed;
      } catch {
        return false;
      }
    };

    socket.on('join_conversation', async (conversationId: string) => {
      // Only participants may listen to a conversation's live messages (the
      // same rule the REST endpoints apply). Anything else — another user's
      // conversation, or another user's private notification room — is ignored.
      if (!(await isParticipant(conversationId))) {
        console.warn(
          `🚫 User ${userId} tried to join a room they are not part of`,
        );
        return;
      }
      socket.join(conversationId);
      console.log(`👤 User ${userId} joined room: ${conversationId}`);
    });

    socket.on('leave_conversation', (conversationId: string) => {
      socket.leave(conversationId);
      console.log(`👤 User ${userId} left room: ${conversationId}`);
    });

    socket.on('typing_start', (conversationId: string) => {
      if (!verifiedConversations.has(conversationId)) return;
      socket.to(conversationId).emit('user_typing', {
        userId,
        conversationId,
        isTyping: true,
      });
    });

    socket.on('typing_stop', (conversationId: string) => {
      if (!verifiedConversations.has(conversationId)) return;
      socket.to(conversationId).emit('user_typing', {
        userId,
        conversationId,
        isTyping: false,
      });
    });

    socket.on(
      'mark_read',
      async (data: { conversationId: string; messageId?: string }) => {
        const conversationId = data?.conversationId;
        if (!(await isParticipant(conversationId))) return;

        // Notify other user that messages are read
        socket.to(conversationId).emit('messages_read', {
          conversationId,
          userId,
          readAt: new Date(),
        });

        // Update DB (Bulk mark for the conversation)
        // Note: In a production app, we'd do this via REST for reliability,
        // but we can offer it via socket too.
        await prisma.message.updateMany({
          where: {
            conversationId,
            isRead: false,
            NOT: { senderId: userId },
          },
          data: {
            isRead: true,
            readAt: new Date(),
          },
        });
      },
    );

    socket.on('disconnect', () => {
      if (userId) {
        const userConnections = onlineUsers.get(userId);
        if (userConnections) {
          userConnections.delete(socket.id);
          if (userConnections.size === 0) {
            onlineUsers.delete(userId);
            console.log(`👤 User ${userId} is offline`);
          }
        }
      }
      console.log(`❌ Disconnected: ${socket.id}`);
    });
  });

  return io;
};
