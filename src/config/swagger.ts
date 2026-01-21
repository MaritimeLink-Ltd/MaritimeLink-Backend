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
            profession: {
              type: 'string',
              enum: ['OFFICER', 'RATINGS_AND_CREW', 'CATERING_AND_MEDICAL'],
              nullable: true,
            },
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
        Resume: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['OFFICER', 'RATINGS_AND_CREW', 'CATERING_AND_MEDICAL'],
              nullable: true,
            },
            subcategory: { type: 'string' },
            address: { type: 'string' },
            city: { type: 'string' },
            state: { type: 'string' },
            postcode: { type: 'string' },
            country: { type: 'string' },
            phoneCode: { type: 'string' },
            phoneNumber: { type: 'string' },
            emailAddress: { type: 'string', format: 'email' },
            dateOfBirth: { type: 'string', format: 'date' },
            summary: { type: 'string' },
            gender: { type: 'string' },
            height: { type: 'number' },
            weight: { type: 'number' },
            bmi: { type: 'number' },
            eyeColor: { type: 'string' },
            overallSize: { type: 'string' },
            shoeSize: { type: 'string' },
            skills: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  skillName: { type: 'string' },
                  rating: { type: 'number' },
                },
              },
            },
            licenses: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  number: { type: 'string' },
                  country: { type: 'string' },
                  issueDate: { type: 'string', format: 'date' },
                  expiryDate: { type: 'string', format: 'date' },
                },
              },
            },
            seaService: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  companyName: { type: 'string' },
                  role: { type: 'string' },
                  vesselName: { type: 'string' },
                  imoNumber: { type: 'string' },
                  flag: { type: 'string' },
                  vesselType: { type: 'string' },
                  dwt: { type: 'string' },
                  meType: { type: 'string' },
                  kwtType: { type: 'string' },
                  joiningDate: { type: 'string', format: 'date' },
                  tillDate: { type: 'string', format: 'date' },
                },
              },
            },
            education: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  qualificationName: { type: 'string' },
                  institution: { type: 'string' },
                  grade: { type: 'string' },
                  startDate: { type: 'string', format: 'date' },
                  endDate: { type: 'string', format: 'date' },
                },
              },
            },
            stcwCertificates: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  qualification: { type: 'string' },
                  certificateNumber: { type: 'string' },
                  issuingCountry: { type: 'string' },
                  issueDate: { type: 'string', format: 'date' },
                  expiryDate: { type: 'string', format: 'date' },
                },
              },
            },
            medicalCertificates: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  certificateNumber: { type: 'string' },
                  issuingCountry: { type: 'string' },
                  issueDate: { type: 'string', format: 'date' },
                  expiryDate: { type: 'string', format: 'date' },
                },
              },
            },
            travelDocuments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  documentNumber: { type: 'string' },
                  issuingCountry: { type: 'string' },
                  issueDate: { type: 'string', format: 'date' },
                  expiryDate: { type: 'string', format: 'date' },
                },
              },
            },
            nextOfKin: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  relationship: { type: 'string' },
                  countryCode: { type: 'string' },
                  phoneNumber: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                },
              },
            },
            referees: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  position: { type: 'string' },
                  countryCode: { type: 'string' },
                  phoneNumber: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                },
              },
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'error' },
            message: { type: 'string' },
          },
        },
        Admin: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            role: {
              type: 'string',
              enum: ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'],
            },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },
  apis: ['./src/controllers/*.ts', './src/routes/*.ts'], // Path to the API docs
};

export const swaggerSpec = swaggerJsdoc(options);
