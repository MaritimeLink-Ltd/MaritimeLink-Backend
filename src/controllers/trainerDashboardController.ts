import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import { CourseStatus, DocumentCategory } from '../generated/client/index.js';
import {
  filterRecruiterInAppNotifications,
  getRecruiterNotificationPreferences,
} from '../services/recruiterAccountSettingsService.js';

const TRAINER_EXPIRY_EXCLUDED_CATEGORIES = [
  DocumentCategory.CV_RESUME,
  DocumentCategory.COVER_LETTER,
];

const PERIOD_TO_DAYS: Record<string, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
  '60d': 60,
  '90d': 90,
  all: 365,
};

const TRAINER_DEMAND_BUCKETS = [
  {
    key: 'stcw',
    label: 'STCW Basic Safety',
    keywords: [
      'stcw',
      'basic safety',
      'safety training',
      'watchkeeping',
      'gmdss',
      'radar',
      'bridge resource',
      'engine room resource',
      'survival craft',
      'crowd management',
      'passenger safety',
    ],
  },
  {
    key: 'firefighting',
    label: 'Advanced Firefighting',
    keywords: ['firefighting', 'fire fighting', 'fire prevention', 'fire'],
  },
  {
    key: 'gwo',
    label: 'GWO Sea Survival',
    keywords: ['gwo', 'sea survival', 'working at heights', 'manual handling'],
  },
  {
    key: 'medical',
    label: 'Medical Care Onboard',
    keywords: ['medical', 'first aid', 'medical care', 'health care'],
  },
];

type TrainerDemandBucketKey =
  | 'stcw'
  | 'firefighting'
  | 'gwo'
  | 'medical'
  | 'other';

type TrainerExpiryRow = {
  id: string;
  professionalId: string;
  professionalName: string;
  rank: string;
  location: string;
  city: string;
  country: string;
  certificateType: string;
  bucket: TrainerDemandBucketKey;
  expiryDate: Date;
  issueDate?: Date | null;
  daysLeft: number;
  sourceCategory?: string | null;
};

const startOfDay = (value: Date) => {
  const copy = new Date(value);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const addDays = (value: Date, days: number) => {
  const copy = new Date(value);
  copy.setDate(copy.getDate() + days);
  return copy;
};

const normalizeTrainerPeriod = (period: unknown) => {
  const value = typeof period === 'string' ? period.trim().toLowerCase() : '';
  if (value === 'today') return 'today';
  if (value === '7d' || value === '7days' || value === '7 days') return '7d';
  if (
    value === '30d' ||
    value === '30days' ||
    value === '30 days' ||
    value === '30'
  )
    return '30d';
  if (
    value === '60d' ||
    value === '60days' ||
    value === '60 days' ||
    value === '60'
  )
    return '60d';
  if (
    value === '90d' ||
    value === '90days' ||
    value === '90 days' ||
    value === '90'
  )
    return '90d';
  if (value === 'all' || value === '') return 'all';
  return '7d';
};

const normalizeText = (value?: string | null) =>
  String(value || '')
    .trim()
    .toLowerCase();

const getBucketForText = (text: string): TrainerDemandBucketKey => {
  const normalized = normalizeText(text);
  if (!normalized) return 'other';

  const found = TRAINER_DEMAND_BUCKETS.find((bucket) =>
    bucket.keywords.some((keyword) => normalized.includes(keyword)),
  );

  return (found?.key || 'other') as TrainerDemandBucketKey;
};

const getBucketLabel = (bucket: TrainerDemandBucketKey) => {
  const found = TRAINER_DEMAND_BUCKETS.find((item) => item.key === bucket);
  return found?.label || 'Other Training';
};

const buildAvailableRegions = (rows: TrainerExpiryRow[]) => {
  const regions = new Map<
    string,
    { value: string; label: string; count: number }
  >();

  rows.forEach((row) => {
    const label =
      row.location && row.location !== 'Unknown' ? row.location : '';
    if (!label) return;

    const value = label;
    const existing = regions.get(value);
    if (existing) {
      existing.count += 1;
      return;
    }

    regions.set(value, { value, label, count: 1 });
  });

  return Array.from(regions.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
};

const getProfessionalDisplayLocation = (professional: {
  resume?: {
    city?: string | null;
    country?: string | null;
  } | null;
}) => {
  const city = normalizeText(professional.resume?.city);
  const country = normalizeText(professional.resume?.country);

  if (city && country)
    return `${city}, ${country}`.replace(/\b\w/g, (c) => c.toUpperCase());
  if (city) return city.replace(/\b\w/g, (c) => c.toUpperCase());
  if (country) return country.replace(/\b\w/g, (c) => c.toUpperCase());
  return 'Unknown';
};

const getProfessionalRank = (professional: {
  profession?: string | null;
  subcategory?: string | null;
  resume?: {
    category?: string | null;
    subcategory?: string | null;
    seaService?: { role?: string | null }[];
  } | null;
}) => {
  const seaServiceRole = professional.resume?.seaService?.[0]?.role;
  return (
    seaServiceRole ||
    professional.resume?.subcategory ||
    professional.subcategory ||
    professional.profession ||
    professional.resume?.category ||
    'Unknown'
  );
};

const getCertificateText = (document: {
  name: string;
  category: DocumentCategory;
  ocrData?: unknown;
}) => {
  const ocrData = (document.ocrData || {}) as Record<string, unknown>;
  return [
    document.name,
    document.category,
    typeof ocrData.name === 'string' ? ocrData.name : '',
    typeof ocrData.qualification === 'string' ? ocrData.qualification : '',
    typeof ocrData.title === 'string' ? ocrData.title : '',
    typeof ocrData.description === 'string' ? ocrData.description : '',
    typeof ocrData.sourceCategory === 'string' ? ocrData.sourceCategory : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
};

const buildTrainerExpiryRow = (
  document: {
    id: string;
    professionalId: string;
    name: string;
    category: DocumentCategory;
    expiryDate: Date | null;
    issueDate: Date | null;
    ocrData: unknown;
    professional: {
      fullname?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      profession?: string | null;
      subcategory?: string | null;
      resume?: {
        city?: string | null;
        country?: string | null;
        category?: string | null;
        subcategory?: string | null;
        seaService?: { role?: string | null }[];
      } | null;
    };
  },
  now: Date,
): TrainerExpiryRow | null => {
  if (!document.expiryDate) return null;

  const professionalName =
    document.professional.fullname ||
    [document.professional.firstName, document.professional.lastName]
      .filter(Boolean)
      .join(' ') ||
    'Unknown';
  const location = getProfessionalDisplayLocation(document.professional);
  const rank = getProfessionalRank(document.professional);
  const text = getCertificateText(document);
  const bucket = getBucketForText(text);

  return {
    id: document.id,
    professionalId: document.professionalId,
    professionalName,
    rank,
    location,
    city: normalizeText(document.professional.resume?.city),
    country: normalizeText(document.professional.resume?.country),
    certificateType: getBucketLabel(bucket),
    bucket,
    expiryDate: document.expiryDate,
    issueDate: document.issueDate,
    daysLeft: Math.max(
      0,
      Math.ceil(
        (new Date(document.expiryDate).getTime() - now.getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    ),
    sourceCategory: (document.ocrData as Record<string, unknown> | null)
      ?.sourceCategory as string | undefined,
  };
};

const matchesTrainerExpiryFilters = (
  row: TrainerExpiryRow,
  filters: {
    period: string;
    region?: string;
    year?: string;
    city?: string;
    certificate?: string;
    course?: string;
    rank?: string;
    search?: string;
  },
) => {
  const periodDays = PERIOD_TO_DAYS[filters.period] ?? 7;
  if (row.daysLeft < 0) return false;
  if (filters.period !== 'all' && row.daysLeft > periodDays) return false;

  if (filters.year && filters.year !== 'all') {
    const expiryYear = new Date(row.expiryDate).getFullYear().toString();
    if (expiryYear !== filters.year) return false;
  }

  if (filters.certificate && filters.certificate !== 'all') {
    const cert = filters.certificate.toLowerCase();
    if (cert === 'stcw' && row.bucket !== 'stcw') return false;
    if (cert === 'firefighting' && row.bucket !== 'firefighting') return false;
    if (cert === 'gwo' && row.bucket !== 'gwo') return false;
    if (cert === 'medical' && row.bucket !== 'medical') return false;
    if (cert === 'other' && row.bucket !== 'other') return false;
  }

  if (filters.course && filters.course !== 'all') {
    const cert = filters.course.toLowerCase();
    if (cert === 'stcw' && row.bucket !== 'stcw') return false;
    if (cert === 'firefighting' && row.bucket !== 'firefighting') return false;
    if (cert === 'gwo' && row.bucket !== 'gwo') return false;
    if (cert === 'medical' && row.bucket !== 'medical') return false;
    if (cert === 'other' && row.bucket !== 'other') return false;
  }

  if (filters.rank && filters.rank !== 'all') {
    if (!normalizeText(row.rank).includes(normalizeText(filters.rank)))
      return false;
  }

  if (filters.city && filters.city !== 'all') {
    if (!normalizeText(row.location).includes(normalizeText(filters.city)))
      return false;
  }

  if (filters.search) {
    const search = normalizeText(filters.search);
    const haystack = [
      row.professionalName,
      row.rank,
      row.location,
      row.certificateType,
      row.bucket,
      row.professionalId,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(search)) return false;
  }

  return true;
};

type TrainerCourseForCapacity = {
  title: string;
  description: string;
  category: string;
  certificationProvided?: string | null;
};

const matchesTrainerCourseMetadataFilters = (
  courseRecord: TrainerCourseForCapacity,
  filters: { course: string; search: string },
) => {
  const haystack = [
    courseRecord.title,
    courseRecord.description,
    courseRecord.category,
    courseRecord.certificationProvided || '',
  ].join(' ');

  if (filters.course && filters.course !== 'all') {
    const bucket = getBucketForText(haystack);
    const cert = filters.course.toLowerCase();
    if (cert === 'stcw' && bucket !== 'stcw') return false;
    if (cert === 'firefighting' && bucket !== 'firefighting') return false;
    if (cert === 'gwo' && bucket !== 'gwo') return false;
    if (cert === 'medical' && bucket !== 'medical') return false;
    if (cert === 'other' && bucket !== 'other') return false;
  }

  if (filters.search) {
    const search = normalizeText(filters.search);
    if (!normalizeText(haystack).includes(search)) return false;
  }

  return true;
};

/**
 * Upcoming sessions only (start >= today). Year/course/search narrow scope.
 * Period (30/60/90d) applies to renewal metrics, not seat inventory — otherwise
 * sessions booked beyond that window show as 0 capacity incorrectly.
 */
const buildTrainerCapacitySessionWhere = (now: Date, year: string) => {
  const and: Array<{ startDate: { gte?: Date; lte?: Date } }> = [
    { startDate: { gte: now } },
  ];

  if (year && year !== 'all') {
    const y = Number.parseInt(year, 10);
    if (!Number.isNaN(y)) {
      and.push(
        { startDate: { gte: new Date(y, 0, 1) } },
        { startDate: { lte: new Date(y, 11, 31, 23, 59, 59, 999) } },
      );
    }
  }

  return { AND: and };
};

const getDemandWindowDays = (period: string) => PERIOD_TO_DAYS[period] ?? 30;

const formatBookingStatusLabel = (raw: string | null | undefined) => {
  const s = String(raw || '').toUpperCase();
  if (s === 'CONFIRMED') return 'Pending approval';
  if (s === 'PENDING') return 'Awaiting payment';
  if (s === 'COMPLETED') return 'Completed';
  if (s === 'CANCELLED') return 'Cancelled';
  return raw ? String(raw) : 'Unknown';
};

/**
 * @desc    Get training dashboard stats
 * @route   GET /api/trainer/dashboard/stats
 * @access  Private (Trainer)
 */
const trainerExpiryProfessionalSelect = {
  id: true,
  fullname: true,
  firstName: true,
  lastName: true,
  profession: true,
  subcategory: true,
  resume: {
    select: {
      city: true,
      country: true,
      category: true,
      subcategory: true,
      seaService: {
        select: { role: true },
        orderBy: { joiningDate: 'desc' as const },
        take: 1,
      },
    },
  },
};

export const getTrainingDashboardStats = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) return next(new AppError('User not authenticated', 401));

    const period = normalizeTrainerPeriod(req.query.timeframe as string);
    const bookingNow = new Date();
    const demandNow = startOfDay(new Date());

    const bookingStartDate = new Date();
    if (period === 'today') {
      bookingStartDate.setHours(0, 0, 0, 0);
    } else if (period === 'all') {
      bookingStartDate.setTime(0);
    } else {
      bookingStartDate.setDate(
        bookingNow.getDate() - getDemandWindowDays(period),
      );
    }

    const [activeCoursesCount, newBookingsCount, expiryDocuments] =
      await Promise.all([
        prisma.course.count({
          where: { recruiterId, status: CourseStatus.ACTIVE },
        }),
        prisma.courseBooking.count({
          where: {
            course: { recruiterId },
            createdAt: { gte: bookingStartDate },
          },
        }),
        prisma.professionalDocument.findMany({
          where: {
            category: { notIn: TRAINER_EXPIRY_EXCLUDED_CATEGORIES },
            expiryDate: { gte: demandNow, lte: addDays(demandNow, 365) },
          },
          include: {
            professional: { select: trainerExpiryProfessionalSelect },
          },
        }),
      ]);

    const expiryRows = expiryDocuments
      .map((document) => buildTrainerExpiryRow(document, demandNow))
      .filter((row): row is TrainerExpiryRow => Boolean(row));

    const windowDays = getDemandWindowDays(period);
    const demandSignalsCount =
      period === 'all'
        ? expiryRows.length
        : expiryRows.filter((row) => row.daysLeft <= windowDays).length;

    res.status(200).json({
      status: 'success',
      data: {
        stats: {
          activeCoursesCount,
          newBookingsCount,
          demandSignalsCount,
        },
      },
    });
  },
);

/**
 * @desc    Get items requiring training provider action
 * @route   GET /api/trainer/dashboard/action-items
 * @access  Private (Trainer)
 */
export const getTrainingActionItems = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) return next(new AppError('User not authenticated', 401));

    const actionItems: {
      type: string;
      message: string;
      action: string;
      courseId?: string;
      courseIds?: string[];
    }[] = [];

    // 1. Learners waiting for courses (Bookings with PENDING status?)
    const pendingBookings = await prisma.courseBooking.count({
      where: { course: { recruiterId }, bookingStatus: 'PENDING' },
    });

    if (pendingBookings > 0) {
      actionItems.push({
        type: 'LEARNERS_WAITING',
        message: `${pendingBookings} learners waiting for course confirmation`,
        action: 'VIEW_BOOKINGS',
      });
    }

    // 2. Courses near capacity (90% full)
    const criticalCourses = await prisma.course.findMany({
      where: { recruiterId, status: CourseStatus.ACTIVE },
      include: {
        _count: {
          select: {
            bookings: {
              where: {
                bookingStatus: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
              },
            },
          },
        },
      },
    });

    criticalCourses.forEach((course) => {
      if (course.capacity && course._count.bookings >= course.capacity * 0.9) {
        actionItems.push({
          type: 'CAPACITY_ALERT',
          message: `Course '${course.title}' is 90% full`,
          action: 'VIEW_BOOKINGS',
          courseId: course.id,
        });
      }
    });

    // 3. Sessions needing scheduling (Courses with no upcoming sessions)
    const coursesNoSessions = await prisma.course.findMany({
      where: {
        recruiterId,
        status: CourseStatus.ACTIVE,
        sessions: { none: { startDate: { gte: new Date() } } },
      },
    });

    if (coursesNoSessions.length > 0) {
      actionItems.push({
        type: 'SESSIONS_NEEDED',
        message: `${coursesNoSessions.length} courses need session scheduling`,
        action: 'ADD_SESSION',
        courseIds: coursesNoSessions.map((c) => c.id),
      });
    }

    res.status(200).json({
      status: 'success',
      results: actionItems.length,
      data: { actionItems },
    });
  },
);

/**
 * @desc    Get training courses overview
 * @route   GET /api/trainer/dashboard/courses
 * @access  Private (Trainer)
 */
export const getTrainingCoursesOverview = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) return next(new AppError('User not authenticated', 401));

    const courses = await prisma.course.findMany({
      where: { recruiterId },
      include: {
        _count: {
          select: {
            bookings: {
              where: {
                bookingStatus: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const enrichedCourses = courses.map((course) => {
      const capacityStatus = !course.capacity
        ? 'Open'
        : course._count.bookings >= course.capacity
          ? 'Full'
          : course._count.bookings >= course.capacity * 0.8
            ? 'Nearly Full'
            : 'Open';
      return {
        id: course.id,
        title: course.title,
        capacityStatus,
        bookingsCount: course._count.bookings,
        totalCapacity: course.capacity,
        status: course.status,
      };
    });

    res.status(200).json({
      status: 'success',
      results: enrichedCourses.length,
      data: { courses: enrichedCourses },
    });
  },
);

export const getTrainingNotifications = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) return next(new AppError('User not authenticated', 401));

    const trainerAccount = await prisma.recruiter.findUnique({
      where: { id: recruiterId },
      select: {
        accountSettings: true,
        organizationVerificationData: true,
      },
    });

    const notificationPreferences = getRecruiterNotificationPreferences(
      trainerAccount?.accountSettings,
      trainerAccount?.organizationVerificationData,
    );

    const [
      pendingPaymentBookings,
      awaitingApprovalBookings,
      coursesNoSessions,
      nearlyFullCourses,
      recentBookings,
    ] = await Promise.all([
      prisma.courseBooking.count({
        where: { course: { recruiterId }, bookingStatus: 'PENDING' },
      }),
      prisma.courseBooking.count({
        where: {
          course: { recruiterId },
          bookingStatus: 'CONFIRMED',
          paymentStatus: 'SUCCEEDED',
        },
      }),
      prisma.course.count({
        where: {
          recruiterId,
          status: CourseStatus.ACTIVE,
          sessions: { none: { startDate: { gte: new Date() } } },
        },
      }),
      prisma.course.findMany({
        where: { recruiterId, status: CourseStatus.ACTIVE },
        include: {
          _count: {
            select: {
              bookings: {
                where: {
                  bookingStatus: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
                },
              },
            },
          },
        },
        take: 5,
      }),
      prisma.courseBooking.findMany({
        where: {
          course: { recruiterId },
          bookingStatus: { not: 'CANCELLED' },
        },
        take: 15,
        orderBy: { createdAt: 'desc' },
        include: {
          professional: {
            select: { fullname: true, email: true },
          },
          course: {
            select: { title: true },
          },
        },
      }),
    ]);

    const capacityAlerts = nearlyFullCourses.filter(
      (course) =>
        course.capacity && course._count.bookings >= course.capacity * 0.8,
    );

    const notifications = [
      awaitingApprovalBookings > 0
        ? {
            id: 'awaiting-approval-bookings',
            type: 'booking',
            severity: 'success',
            title: 'Bookings Awaiting Approval',
            message: `${awaitingApprovalBookings} paid booking(s) need your approval in session attendance.`,
            createdAt: new Date(),
          }
        : null,
      pendingPaymentBookings > 0
        ? {
            id: 'pending-bookings',
            type: 'booking',
            severity: 'info',
            title: 'Incomplete Bookings',
            message: `${pendingPaymentBookings} booking(s) are awaiting payment.`,
            createdAt: new Date(),
          }
        : null,
      coursesNoSessions > 0
        ? {
            id: 'courses-no-sessions',
            type: 'warning',
            severity: 'warning',
            title: 'Sessions Needed',
            message: `${coursesNoSessions} active courses need upcoming sessions.`,
            createdAt: new Date(),
          }
        : null,
      ...capacityAlerts.map((course) => ({
        id: `capacity-${course.id}`,
        type: 'warning',
        severity: 'warning',
        title: 'Course Nearly Full',
        message: `"${course.title}" is close to capacity.`,
        createdAt: new Date(),
      })),
      ...recentBookings.map((booking) => ({
        id: `booking-${booking.id}`,
        type: 'booking',
        severity: 'info',
        title: 'Recent Course Booking',
        message: `${booking.professional.fullname || booking.professional.email} booked "${booking.course.title}" (${formatBookingStatusLabel(booking.bookingStatus)}).`,
        createdAt: booking.createdAt,
      })),
    ].filter(Boolean);

    const filteredNotifications = filterRecruiterInAppNotifications(
      notifications.filter((item): item is NonNullable<typeof item> =>
        Boolean(item),
      ),
      notificationPreferences,
    );

    res.status(200).json({
      status: 'success',
      results: filteredNotifications.length,
      data: { notifications: filteredNotifications },
    });
  },
);

const getMonthKey = (date: Date) =>
  date.toLocaleString('en-US', { month: 'short' });

const buildMonthBuckets = (startDate: Date, months = 12) => {
  const buckets: { key: string; label: string; index: number }[] = [];
  const cursor = new Date(startDate);
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);

  for (let index = 0; index < months; index += 1) {
    const current = new Date(cursor);
    current.setMonth(cursor.getMonth() + index);
    buckets.push({
      key: `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`,
      label: getMonthKey(current),
      index,
    });
  }

  return buckets;
};

export const getTrainingDemandOverview = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) return next(new AppError('User not authenticated', 401));

    const period = normalizeTrainerPeriod(req.query.period);
    const region =
      typeof req.query.region === 'string' ? req.query.region : 'all';
    const year = typeof req.query.year === 'string' ? req.query.year : 'all';
    const course =
      typeof req.query.course === 'string' ? req.query.course : 'all';
    const search = typeof req.query.search === 'string' ? req.query.search : '';

    const now = startOfDay(new Date());
    const windowDays = getDemandWindowDays(period);
    const windowEnd = addDays(now, windowDays);
    const previousWindowStart = addDays(now, -windowDays);

    const [documents, courses, pendingBookingsCount, previousDocuments] =
      await Promise.all([
        prisma.professionalDocument.findMany({
          where: {
            category: { notIn: TRAINER_EXPIRY_EXCLUDED_CATEGORIES },
            expiryDate: { gte: now, lte: addDays(now, 365) },
          },
          include: {
            professional: {
              select: {
                id: true,
                fullname: true,
                firstName: true,
                lastName: true,
                profession: true,
                subcategory: true,
                resume: {
                  select: {
                    city: true,
                    country: true,
                    category: true,
                    subcategory: true,
                    seaService: {
                      select: {
                        role: true,
                      },
                      orderBy: {
                        joiningDate: 'desc',
                      },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
          orderBy: { expiryDate: 'asc' },
        }),
        prisma.course.findMany({
          where: { recruiterId, status: CourseStatus.ACTIVE },
          include: {
            sessions: {
              where: buildTrainerCapacitySessionWhere(now, year),
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.courseBooking.count({
          where: {
            course: { recruiterId },
            bookingStatus: 'PENDING',
          },
        }),
        prisma.professionalDocument.findMany({
          where: {
            category: { notIn: TRAINER_EXPIRY_EXCLUDED_CATEGORIES },
            expiryDate: { gte: previousWindowStart, lt: now },
          },
          include: {
            professional: {
              select: {
                id: true,
                fullname: true,
                firstName: true,
                lastName: true,
                profession: true,
                subcategory: true,
                resume: {
                  select: {
                    city: true,
                    country: true,
                    category: true,
                    subcategory: true,
                    seaService: {
                      select: {
                        role: true,
                      },
                      orderBy: {
                        joiningDate: 'desc',
                      },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
          orderBy: { expiryDate: 'asc' },
        }),
      ]);

    const allRows = documents
      .map((document) => buildTrainerExpiryRow(document, now))
      .filter((row): row is TrainerExpiryRow => Boolean(row));
    const availableRegions = buildAvailableRegions(allRows);

    /** Year / course / search only — same horizon as the chart (12 months of fetched docs). */
    const rowsScoped = allRows.filter((row) =>
      matchesTrainerExpiryFilters(row, {
        period: 'all',
        region,
        year,
        course,
        search,
      }),
    );

    const rowsInPeriod =
      period === 'all'
        ? rowsScoped
        : rowsScoped.filter((row) => row.daysLeft <= windowDays);

    const previousRows = previousDocuments
      .map((document) => buildTrainerExpiryRow(document, now))
      .filter((row): row is TrainerExpiryRow => Boolean(row));

    const currentInWindow = rowsInPeriod;

    const coursesForCapacity = courses.filter((courseRecord) =>
      matchesTrainerCourseMetadataFilters(courseRecord, { course, search }),
    );

    let totalBookedSeats = 0;
    let totalCapacity = 0;
    coursesForCapacity.forEach((courseRecord) => {
      courseRecord.sessions.forEach((session) => {
        const cap = Number(session.totalSeats) || 0;
        const avail = Number(session.availableSeats) || 0;
        totalCapacity += cap;
        totalBookedSeats += Math.max(0, cap - avail);
      });
    });
    const overallUtilization =
      totalCapacity > 0
        ? Math.round((totalBookedSeats / totalCapacity) * 100)
        : totalBookedSeats > 0
          ? null
          : 0;

    const currentBucketCounts = currentInWindow.reduce(
      (acc, row) => {
        acc[row.bucket] = (acc[row.bucket] || 0) + 1;
        return acc;
      },
      { stcw: 0, firefighting: 0, gwo: 0, medical: 0, other: 0 } as Record<
        TrainerDemandBucketKey,
        number
      >,
    );

    const scopedDocIds = new Set(rowsScoped.map((row) => row.id));

    const forecastBuckets = buildMonthBuckets(now, 12);
    const forecast = forecastBuckets.map((bucket, index) => {
      const monthStart = new Date(now.getFullYear(), now.getMonth() + index, 1);
      const monthEnd = new Date(
        now.getFullYear(),
        now.getMonth() + index + 1,
        0,
        23,
        59,
        59,
        999,
      );

      const monthRows = documents.filter((document) => {
        if (!scopedDocIds.has(document.id)) return false;
        if (!document.expiryDate) return false;
        const expiry = document.expiryDate;
        return expiry >= monthStart && expiry <= monthEnd;
      });

      const counters = {
        stcw: 0,
        firefighting: 0,
        gwo: 0,
        medical: 0,
        other: 0,
      };

      monthRows.forEach((document) => {
        const row = buildTrainerExpiryRow(document, now);
        if (row) counters[row.bucket] += 1;
      });

      return {
        month: bucket.label,
        ...counters,
      };
    });

    const renewalDemandMap = new Map<
      TrainerDemandBucketKey,
      { count: number; previous: number; locations: Set<string> }
    >();
    rowsScoped.forEach((row) => {
      if (!renewalDemandMap.has(row.bucket)) {
        renewalDemandMap.set(row.bucket, {
          count: 0,
          previous: previousRows.filter((prev) => prev.bucket === row.bucket)
            .length,
          locations: new Set<string>(),
        });
      }
      const entry = renewalDemandMap.get(row.bucket)!;
      entry.count += 1;
      if (row.location) entry.locations.add(row.location);
    });

    const renewalDemand = Array.from(renewalDemandMap.entries())
      .map(([bucket, entry]) => ({
        bucket,
        course: getBucketLabel(bucket),
        expiring: entry.count,
        trend: entry.previous,
        trendChange: entry.count - entry.previous,
        locations:
          Array.from(entry.locations).slice(0, 2).join(' • ') || 'Various',
      }))
      .sort((a, b) => b.expiring - a.expiring)
      .slice(0, 5);

    const engagementCourses = coursesForCapacity
      .map((courseRecord) => {
        let capacity = 0;
        let booked = 0;
        courseRecord.sessions.forEach((session) => {
          const cap = Number(session.totalSeats) || 0;
          const avail = Number(session.availableSeats) || 0;
          capacity += cap;
          booked += Math.max(0, cap - avail);
        });
        const utilization =
          capacity > 0 ? Math.round((booked / capacity) * 100) : 0;
        const statusVariant =
          utilization >= 90
            ? 'warning'
            : utilization >= 70
              ? 'success'
              : utilization >= 40
                ? 'info'
                : 'neutral';

        return {
          name: courseRecord.title,
          status:
            utilization >= 90
              ? 'Low availability'
              : utilization >= 70
                ? 'On track'
                : utilization >= 40
                  ? 'Growing'
                  : 'Emerging',
          statusVariant,
          views: String(booked * 8 + 100),
          enquiries: String(Math.max(0, Math.round(booked * 0.35))),
          utilization,
        };
      })
      .sort((a, b) => b.utilization - a.utilization)
      .slice(0, 4);

    const uniqueProfessionals = new Set(
      rowsScoped.map((row) => row.professionalId),
    ).size;
    const uniqueCurrentMonth = new Set(
      rowsScoped
        .filter(
          (row) =>
            row.expiryDate &&
            row.expiryDate >= now &&
            row.expiryDate <= windowEnd,
        )
        .map((row) => row.professionalId),
    ).size;

    res.status(200).json({
      status: 'success',
      data: {
        summary: {
          /** Certificates due within the selected period tab (30/60/90d or all). */
          certificatesExpiring: currentInWindow.length,
          /** Same filters, full ~12 month horizon returned by this endpoint. */
          certificatesExpiringTracked: rowsScoped.length,
          certificatesExpiringWindowLabel:
            period === 'all'
              ? 'Next 12 months (tracked)'
              : `Next ${windowDays} days`,
          certificateSummaryByWindow: {
            '30 Days': currentBucketCounts,
            '60 Days': currentBucketCounts,
            '90 Days': currentBucketCounts,
          },
          courseSearchDemand: uniqueProfessionals,
          activeEnquiries: pendingBookingsCount,
          uniqueCurrentMonth,
          capacity: {
            utilization: overallUtilization,
            bookedSeats: totalBookedSeats,
            totalSeats: totalCapacity,
          },
        },
        forecast,
        renewalDemand,
        engagementCourses,
        availableRegions,
        filters: {
          period,
          region,
          year,
          course,
          search,
        },
      },
    });
  },
);

export const getTrainingExpiringCertificates = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) return next(new AppError('User not authenticated', 401));

    const period = normalizeTrainerPeriod(req.query.period);
    const region =
      typeof req.query.region === 'string' ? req.query.region : 'all';
    const year = typeof req.query.year === 'string' ? req.query.year : 'all';
    const city = typeof req.query.city === 'string' ? req.query.city : 'all';
    const certificate =
      typeof req.query.certificate === 'string' ? req.query.certificate : 'all';
    const rank = typeof req.query.rank === 'string' ? req.query.rank : 'all';
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 12));

    const now = startOfDay(new Date());
    const documents = await prisma.professionalDocument.findMany({
      where: {
        category: { notIn: TRAINER_EXPIRY_EXCLUDED_CATEGORIES },
        expiryDate: { gte: now, lte: addDays(now, 365) },
      },
      include: {
        professional: {
          select: {
            id: true,
            fullname: true,
            firstName: true,
            lastName: true,
            profession: true,
            subcategory: true,
            resume: {
              select: {
                city: true,
                country: true,
                category: true,
                subcategory: true,
                seaService: {
                  select: {
                    role: true,
                  },
                  orderBy: {
                    joiningDate: 'desc',
                  },
                  take: 1,
                },
              },
            },
          },
        },
      },
      orderBy: { expiryDate: 'asc' },
    });

    const allRows = documents
      .map((document) => buildTrainerExpiryRow(document, now))
      .filter((row): row is TrainerExpiryRow => Boolean(row));
    const availableRegions = buildAvailableRegions(allRows);

    const rows = allRows.filter((row) =>
      matchesTrainerExpiryFilters(row, {
        period,
        region,
        year,
        city,
        certificate,
        rank,
        search,
      }),
    );

    const start = (page - 1) * limit;
    const paginatedRows = rows.slice(start, start + limit);
    const total = rows.length;

    res.status(200).json({
      status: 'success',
      results: paginatedRows.length,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
      data: {
        availableRegions,
        expiries: paginatedRows.map((row) => ({
          ...row,
          expiryDate: row.expiryDate,
          issueDate: row.issueDate || null,
        })),
      },
    });
  },
);
