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

    expect(filtered).toHaveLength(0);
  });
});
