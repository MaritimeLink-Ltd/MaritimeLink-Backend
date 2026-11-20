/**
 * Admin team roles.
 *
 * - SUPER_ADMIN: everything, including managing the admin team.
 * - OPERATIONS_MANAGER (shown as "Team Member"): runs the platform day to day (users, KYC, jobs,
 *   courses, support, reports…) but cannot see money — revenue, commission,
 *   payouts, transactions — and cannot manage the admin team.
 * - ADMIN / MODERATOR: legacy roles; they keep exactly the access they had
 *   before team management existed (everything except managing the team).
 */
export const PLATFORM_ADMIN_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'MODERATOR',
  'OPERATIONS_MANAGER',
] as const;

export type PlatformAdminRole = (typeof PLATFORM_ADMIN_ROLES)[number];

/** Roles a super admin can give when inviting someone. */
export const INVITABLE_ADMIN_ROLES = [
  'SUPER_ADMIN',
  'OPERATIONS_MANAGER',
] as const;

export const ADMIN_ROLE_LABELS: Record<PlatformAdminRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MODERATOR: 'Moderator',
  // Restricted access level. The person's actual job (Operations Manager,
  // Developer, Support…) is their free-text `title`.
  OPERATIONS_MANAGER: 'Team Member',
};

/** One line on what an access level allows, for emails and the UI. */
export const adminAccessSummary = (role?: string | null): string =>
  role === 'SUPER_ADMIN'
    ? 'Full access, including revenue, commission, payouts and managing the admin team.'
    : role === 'OPERATIONS_MANAGER'
      ? 'Access to the admin panel except revenue, commission, payouts and managing the admin team.'
      : 'Access to the admin panel.';

/** Title shown for a team member: their job title, or their access level. */
export const adminDisplayTitle = (
  title?: string | null,
  role?: string | null,
): string => (title && title.trim()) || adminRoleLabel(role);

export const isPlatformAdminRole = (role?: string | null): boolean =>
  !!role && (PLATFORM_ADMIN_ROLES as readonly string[]).includes(role);

export const canManageAdminTeam = (role?: string | null): boolean =>
  role === 'SUPER_ADMIN';

export const canViewFinancials = (role?: string | null): boolean =>
  isPlatformAdminRole(role) && role !== 'OPERATIONS_MANAGER';

export const adminRoleLabel = (role?: string | null): string =>
  (role && ADMIN_ROLE_LABELS[role as PlatformAdminRole]) || 'Admin';
