import express, { Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { errorHandler } from './middlewares/errorHandler.js';

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

// Routes will be added here
// app.use('/api', routes);

// Error handling (must be last)
app.use(errorHandler);

export default app;
