import { describe, expect, it } from '@jest/globals';
import {
  filterRecruiterInAppNotifications,
  getRecruiterNotificationPreferences,
  normalizeNotificationPreferences,
} from '../services/recruiterAccountSettingsService.js';

describe('recruiterAccountSettingsService', () => {
  it('normalizes boolean-like payload values', () => {
    expect(
      normalizeNotificationPreferences({
        newApplications: 'false',
        marketing: 1,
        jobPostings: 0,
      }),
    ).toEqual(
      expect.objectContaining({
        newApplications: false,
        marketing: true,
        jobPostings: false,
      }),
    );
  });

  it('reads legacy preferences from organization verification JSON', () => {
    const prefs = getRecruiterNotificationPreferences(null, {
      company_website: 'https://example.com',
      _recruiterSettings: {
        notifications: {
          newApplications: false,
          marketing: true,
        },
      },
    });

    expect(prefs.newApplications).toBe(false);
    expect(prefs.marketing).toBe(true);
    expect(prefs.securityAlerts).toBe(true);
  });

  it('filters in-app notifications by preference', () => {
    const prefs = getRecruiterNotificationPreferences({
      notifications: {
        newApplications: false,
        jobPostings: false,
        marketing: false,
      },
    });

    const filtered = filterRecruiterInAppNotifications(
      [
        { id: 'new-applications', type: 'success' },
        { id: 'draft-jobs', type: 'info' },
        { id: 'recruiter-announcement', type: 'announcement' },
        { id: 'custom-platform', type: 'info' },
      ],
      prefs,
    );

    expect(filtered.map((item) => item.id)).toEqual(['custom-platform']);
  });

  it('filters training provider in-app notifications by preference', () => {
    const prefs = getRecruiterNotificationPreferences({
      notifications: {
        newApplications: false,
        jobPostings: false,
        marketing: false,
      },
    });

    const filtered = filterRecruiterInAppNotifications(
      [
        { id: 'pending-bookings', type: 'success' },
        { id: 'courses-no-sessions', type: 'warning' },
        { id: 'capacity-abc', type: 'warning' },
        { id: 'trainer-announcement', type: 'announcement' },
        {
          id: 'booking-1',
          type: 'info',
          title: 'Recent Course Booking',
        },
      ],
      prefs,
    );

    expect(filtered.map((item) => item.id)).toEqual([
      'pending-bookings',
      'booking-1',
    ]);
  });

  it('always shows course booking notifications regardless of application prefs', () => {
    const prefs = getRecruiterNotificationPreferences({
      notifications: {
        newApplications: false,
        jobPostings: false,
        marketing: false,
      },
    });

    const filtered = filterRecruiterInAppNotifications(
      [
        {
          id: 'awaiting-approval-bookings',
          type: 'booking',
          title: 'Bookings Awaiting Approval',
        },
        {
          id: 'booking-abc',
          type: 'booking',
          title: 'Recent Course Booking',
        },
      ],
      prefs,
    );

    expect(filtered).toHaveLength(2);
  });

  it('shows operational warnings when job postings enabled regardless of urgentAlerts', () => {
    const prefs = getRecruiterNotificationPreferences({
      notifications: {
        urgentAlerts: false,
        jobPostings: true,
        marketing: true,
      },
    });

    const filtered = filterRecruiterInAppNotifications(
      [
        { id: 'zero-applicant-jobs', type: 'warning', severity: 'warning' },
        {
          id: 'recruiter-announcement',
          type: 'announcement',
          severity: 'info',
        },
      ],
      prefs,
    );

    expect(filtered.map((item) => item.id)).toEqual(['zero-applicant-jobs']);
  });

  it('filters chat notifications when candidateMessages is off', () => {
    const prefs = getRecruiterNotificationPreferences({
      notifications: { candidateMessages: false },
    });

    const filtered = filterRecruiterInAppNotifications(
      [{ id: 'new-chat-message', type: 'message' }],
      prefs,
    );

    expect(filtered).toHaveLength(0);
  });
});
