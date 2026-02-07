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
    tags: [
      {
        name: 'Professional',
        description: 'Endpoints for maritime professionals',
      },
      {
        name: 'Recruiter',
        description: 'Endpoints for recruiters and training agents',
      },
      {
        name: 'Professional KYC',
        description: 'KYC verification for professionals',
      },
      { name: 'Recruiter KYC', description: 'KYC verification for recruiters' },
      { name: 'Courses', description: 'Course management and discovery' },
      {
        name: 'Course Sessions',
        description: 'Management of specific course dates/slots',
      },
      {
        name: 'Course Bookings',
        description: 'Registration and payments for courses',
      },
      {
        name: 'Trainer Bookings',
        description: 'Trainer-side booking management',
      },
      {
        name: 'Trainer Revenue',
        description: 'Revenue and analytics for trainers',
      },
      { name: 'Admin', description: 'Platform administration and moderation' },
      {
        name: 'Admin Operations',
        description: 'System monitoring and activity logs',
      },
      { name: 'Admin Support', description: 'Managing global support tickets' },
      { name: 'Admin Jobs', description: 'Job moderation and management' },
      {
        name: 'Admin Courses',
        description: 'Course moderation and global bookings',
      },
      {
        name: 'Admin Revenue',
        description: 'Platform-wide financial analytics',
      },
      { name: 'Jobs', description: 'Job posting and search' },
      {
        name: 'Professional Documents',
        description: 'Professional document wallet',
      },
      {
        name: 'Professional Support',
        description: 'Support cases for professionals',
      },
      {
        name: 'Professional Jobs',
        description: 'Job discovery and applications for professionals',
      },
      {
        name: 'Professional Applications',
        description: 'Management of job applications',
      },
      { name: 'Support', description: 'General user support' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      responses: {
        UnauthorizedError: {
          description: 'Access token is missing or invalid',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        NotFoundError: {
          description: 'The specified resource was not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        ValidationError: {
          description: 'Validation failed',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
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
        Job: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            location: { type: 'string' },
            category: {
              type: 'string',
              enum: ['OFFICER', 'RATINGS_AND_CREW', 'CATERING_AND_MEDICAL'],
            },
            contractType: {
              type: 'string',
              enum: ['TEMPORARY', 'CONTRACT', 'PERMANENT'],
            },
            salary: { type: 'string' },
            description: { type: 'string' },
            recruiterId: { type: 'string', format: 'uuid', nullable: true },
            adminId: { type: 'string', format: 'uuid', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        SavedJob: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            professionalId: { type: 'string', format: 'uuid' },
            jobId: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Course: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            location: { type: 'string' },
            category: { type: 'string' },
            contractType: { type: 'string' },
            description: { type: 'string' },
            recruiterId: { type: 'string', format: 'uuid', nullable: true },
            adminId: { type: 'string', format: 'uuid', nullable: true },
            sessions: {
              type: 'array',
              items: { $ref: '#/components/schemas/CourseSession' },
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CourseSession: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            courseId: { type: 'string', format: 'uuid' },
            startDate: { type: 'string', format: 'date-time' },
            endDate: { type: 'string', format: 'date-time' },
            startTime: { type: 'string' },
            endTime: { type: 'string' },
            location: { type: 'string' },
            instructor: { type: 'string' },
            totalSeats: { type: 'integer' },
            availableSeats: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Conversation: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            professionalId: { type: 'string', format: 'uuid' },
            recruiterId: { type: 'string', format: 'uuid' },
            lastMessageAt: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            messages: {
              type: 'array',
              items: { $ref: '#/components/schemas/Message' },
            },
          },
        },
        Message: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            conversationId: { type: 'string', format: 'uuid' },
            senderType: {
              type: 'string',
              enum: ['PROFESSIONAL', 'RECRUITER'],
            },
            senderId: { type: 'string', format: 'uuid' },
            content: { type: 'string' },
            isRead: { type: 'boolean' },
            readAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        ProfessionalDocument: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            professionalId: { type: 'string', format: 'uuid' },
            category: {
              type: 'string',
              enum: [
                'LICENSES_ENDORSEMENTS',
                'MEDICAL_CERTIFICATES',
                'TRAVEL_DOCUMENTS',
                'SEAMANS_BOOK',
                'ACADEMIC_QUALIFICATIONS',
                'MISC_COMPANY_LETTERS',
                'RECENT_APPRAISALS',
              ],
            },
            name: { type: 'string' },
            number: { type: 'string', nullable: true },
            issuingCountry: { type: 'string', nullable: true },
            issueDate: { type: 'string', format: 'date-time', nullable: true },
            expiryDate: { type: 'string', format: 'date-time', nullable: true },
            fileUrl: { type: 'string', format: 'url' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        ProfessionalKyc: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            professionalId: { type: 'string', format: 'uuid' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            dateOfBirth: { type: 'string', format: 'date-time' },
            documentType: {
              type: 'string',
              enum: [
                'PASSPORT',
                'DRIVING_LICENSE',
                'NATIONAL_ID',
                'RESIDENCE_PERMIT',
              ],
            },
            documentNumber: { type: 'string' },
            expiryDate: { type: 'string', format: 'date-time' },
            issueCountry: { type: 'string' },
            documentUrl: { type: 'string', format: 'url' },
            selfieUrl: { type: 'string', format: 'url', nullable: true },
            status: {
              type: 'string',
              enum: ['PENDING', 'APPROVED', 'REJECTED'],
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        RecruiterKyc: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            recruiterId: { type: 'string', format: 'uuid' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            dateOfBirth: { type: 'string', format: 'date-time' },
            documentType: {
              type: 'string',
              enum: [
                'PASSPORT',
                'DRIVING_LICENSE',
                'NATIONAL_ID',
                'RESIDENCE_PERMIT',
              ],
            },
            documentNumber: { type: 'string' },
            expiryDate: { type: 'string', format: 'date-time' },
            issueCountry: { type: 'string' },
            documentUrl: { type: 'string', format: 'url' },
            selfieUrl: { type: 'string', format: 'url', nullable: true },
            status: {
              type: 'string',
              enum: ['PENDING', 'APPROVED', 'REJECTED'],
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CourseBooking: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            professionalId: { type: 'string', format: 'uuid' },
            courseId: { type: 'string', format: 'uuid' },
            sessionId: { type: 'string', format: 'uuid', nullable: true },
            bookingStatus: {
              type: 'string',
              enum: ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'],
            },
            paymentStatus: {
              type: 'string',
              enum: ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'],
            },
            amountPaid: { type: 'number' },
            currency: { type: 'string' },
            bookedAt: { type: 'string', format: 'date-time' },
            paidAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        SupportCase: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            ticketId: { type: 'string', example: 'SC-1234' },
            subject: { type: 'string' },
            description: { type: 'string' },
            category: { type: 'string' },
            status: {
              type: 'string',
              enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
            },
            priority: {
              type: 'string',
              enum: ['LOW', 'MEDIUM', 'HIGH'],
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        SupportNote: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            caseId: { type: 'string', format: 'uuid' },
            senderType: { type: 'string', enum: ['USER', 'ADMIN'] },
            content: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        JobApplication: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            jobId: { type: 'string', format: 'uuid' },
            professionalId: { type: 'string', format: 'uuid' },
            status: {
              type: 'string',
              enum: [
                'PENDING',
                'REVIEWING',
                'SHORTLISTED',
                'ACCEPTED',
                'REJECTED',
              ],
            },
            appliedAt: { type: 'string', format: 'date-time' },
            resumeUrl: { type: 'string', format: 'url', nullable: true },
            coverLetter: { type: 'string', nullable: true },
          },
        },
        Alert: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            professionalId: { type: 'string', format: 'uuid' },
            type: { type: 'string', example: 'CERTIFICATE_EXPIRY' },
            title: { type: 'string', example: 'Certificate Expiring Soon' },
            message: {
              type: 'string',
              example: 'Your STCW Basic Safety certificate expires in 30 days.',
            },
            isRead: { type: 'boolean', example: false },
            readAt: { type: 'string', format: 'date-time', nullable: true },
            metadata: { type: 'object' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        ActivityLog: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            action: { type: 'string', example: 'DOCUMENT_UPLOADED' },
            actorId: { type: 'string', format: 'uuid' },
            actorType: {
              type: 'string',
              enum: ['ADMIN', 'RECRUITER', 'PROFESSIONAL', 'SYSTEM'],
            },
            status: { type: 'string', enum: ['SUCCESS', 'FAILED', 'WARNING'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        OCRData: {
          type: 'object',
          properties: {
            name: { type: 'string', nullable: true },
            number: { type: 'string', nullable: true },
            issuingCountry: { type: 'string', nullable: true },
            issueDate: { type: 'string', format: 'date', nullable: true },
            expiryDate: { type: 'string', format: 'date', nullable: true },
            rawText: { type: 'string', nullable: true },
          },
        },
      },
    },
  },
  apis: ['./src/controllers/*.ts', './src/routes/*.ts'], // Path to the API docs
};

export const swaggerSpec = swaggerJsdoc(options);
