import { prisma } from '../config/prisma.js';
import { ActionStatus, ActorType } from '../generated/client/index.js';

interface LogActivityParams {
  action: string;
  actorId: string;
  actorType: ActorType;
  targetId?: string;
  targetType?: string;
  ipAddress?: string;
  userAgent?: string;
  status?: ActionStatus;
  metadata?: Record<string, unknown>;
}

export const logActivity = async (params: LogActivityParams) => {
  try {
    await prisma.activityLog.create({
      data: {
        action: params.action,
        actorId: params.actorId,
        actorType: params.actorType,
        targetId: params.targetId,
        targetType: params.targetType,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        status: params.status || ActionStatus.SUCCESS,
        metadata: params.metadata || {},
      },
    });
  } catch (error) {
    // Failing to log should not crash the main application, but we should know about it
    console.error('❌ Failed to create activity log:', error);
  }
};
