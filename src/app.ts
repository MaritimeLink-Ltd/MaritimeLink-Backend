import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { errorHandler } from './middlewares/errorHandler.js';
import { AppError } from './utils/AppError.js';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.js';
import professionalRoutes from './routes/professionalRoutes.js';
import recruiterRoutes from './routes/recruiterRoutes.js';
import authRoutes from './routes/authRoutes.js';
import professionalResumeRoutes from './routes/professionalResumeRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import jobRoutes from './routes/jobRoutes.js';
import courseRoutes from './routes/courseRoutes.js';
import conversationRoutes from './routes/conversationRoutes.js';
import professionalBookingRoutes from './routes/professionalBookingRoutes.js';
import professionalDashboardRoutes from './routes/professionalDashboardRoutes.js';
import recruiterDashboardRoutes from './routes/recruiterDashboardRoutes.js';
import trainerDashboardRoutes from './routes/trainerDashboardRoutes.js';
import adminDashboardRoutes from './routes/adminDashboardRoutes.js';
import trainerRoutes from './routes/trainerRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';

const app = express();
app.set('trust proxy', true);

// Health check (Root)
app.get('/', (req: Request, res: Response) => {
  res.status(200).send('API is Live');
});

// Health check (Specific)
app.get('/health', (req: Request, res: Response) => {
  console.log(
    `🏥 Health check request received at ${new Date().toISOString()}`,
  );
  res.status(200).send('OK');
});

// Security & optimization middleware
app.use(helmet());
app.use(cors());
app.use(compression());

// Webhook routes (MUST be before body parsers for raw body verification)
app.use('/api/webhooks', webhookRoutes);

// Global body parsers (Only applies to routes below)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Remove X-Powered-By header
app.disable('x-powered-by');

// Swagger Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Recruiter routes
app.use('/api/recruiter', recruiterRoutes);

// Trainer routes
app.use('/api/trainer', trainerRoutes);

// Unified Auth routes
app.use('/api/auth', authRoutes);

// Resume routes
app.use('/api/professional/resume', professionalResumeRoutes);

// Professional routes
app.use('/api/professional', professionalRoutes);

// Admin routes
app.use('/api/admin', adminRoutes);

// Job & Course routes
app.use('/api/jobs', jobRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/conversations', conversationRoutes);

// Booking routes
app.use('/api/professional', professionalBookingRoutes);

// Dashboard routes
app.use('/api/professional/dashboard', professionalDashboardRoutes);
app.use('/api/recruiter/dashboard', recruiterDashboardRoutes);
app.use('/api/trainer/dashboard', trainerDashboardRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);

// 404 handler
app.use((req: Request, res: Response, next: NextFunction) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Error handling (must be last)
app.use(errorHandler);

export default app;
