import swaggerJsdoc from 'swagger-jsdoc';
import { env } from './env.js';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Maritime Professional API',
      version: '1.0.0',
      description:
        'API documentation for the Maritime Professional registration and authentication flow.',
    },
    servers: [
      {
        url: env.BACKEND_URL || `http://localhost:${env.PORT}`,
        description: env.BACKEND_URL
          ? 'Production server'
          : 'Development server',
      },
      {
        url: 'https://maritime-apis.onrender.com',
        description: 'Production server (Render)',
      },
      {
        url: `http://localhost:${env.PORT}`,
        description: 'Local development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Professional: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            fullname: { type: 'string' },
            email: { type: 'string', format: 'email' },
            profession: { type: 'string', nullable: true },
            idPassportUrl: { type: 'string', format: 'url', nullable: true },
            bio: { type: 'string', nullable: true },
            isVerified: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Recruiter: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            role: {
              type: 'string',
              enum: ['RECRUITMENT_AGENT', 'TRAINING_AGENT'],
            },
            organizationName: { type: 'string', nullable: true },
            address: { type: 'string', nullable: true },
            website: { type: 'string', nullable: true },
            orgEmail: { type: 'string', nullable: true },
            idPassportUrl: { type: 'string', format: 'url', nullable: true },
            status: {
              type: 'string',
              enum: ['PENDING', 'APPROVED', 'REJECTED'],
            },
            isVerified: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'error' },
            message: { type: 'string' },
          },
        },
      },
    },
  },
  apis: ['./src/controllers/*.ts', './src/routes/*.ts'], // Path to the API docs
};

export const swaggerSpec = swaggerJsdoc(options);
