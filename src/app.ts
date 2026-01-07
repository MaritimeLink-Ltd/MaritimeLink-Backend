import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { errorHandler } from './middlewares/errorHandler.js';
import { AppError } from './utils/AppError.js';
import professionalRoutes from './routes/professionalRoutes.js';

const app = express();

// Security & optimization middleware
app.use(helmet());
app.use(cors());
app.use(compression());

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Remove X-Powered-By header
app.disable('x-powered-by');

// Health check route
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Professional routes
app.use('/api/professional', professionalRoutes);

// 404 handler
app.use((req: Request, res: Response, next: NextFunction) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Error handling (must be last)
app.use(errorHandler);

export default app;
