import { ProfessionalSeaServiceLog } from '../generated/client/index.js';

type SeaServiceLike = Pick<
  ProfessionalSeaServiceLog,
  'joiningDate' | 'tillDate' | 'vesselType' | 'role' | 'vesselName'
>;

export type SeaServiceDuration = {
  years: number;
  months: number;
  totalMonths: number;
};

export type VesselTypeBreakdown = SeaServiceDuration & {
  vesselType: string;
  label: string;
};

export type SeaServiceExperience = {
  total: SeaServiceDuration & { label: string };
  byVesselType: VesselTypeBreakdown[];
  experienceLines: string[];
  uniqueVesselTypes: string[];
};

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;

const normalizeVesselTypeKey = (value?: string | null) =>
  String(value || '')
    .trim()
    .toLowerCase();

const displayVesselType = (value?: string | null) => String(value || '').trim();

const resolveVesselTypeLabel = (log: SeaServiceLike) => {
  const vesselType = displayVesselType(log.vesselType);
  const vesselName = displayVesselType(log.vesselName);

  if (!vesselType) return '';
  if (
    vesselName &&
    normalizeVesselTypeKey(vesselType) === normalizeVesselTypeKey(vesselName)
  ) {
    return '';
  }

  return vesselType;
};

export const diffMonthsBetween = (
  joiningDate?: Date | string | null,
  tillDate?: Date | string | null,
): number => {
  if (!joiningDate || !tillDate) return 0;

  const start = new Date(joiningDate);
  const end = new Date(tillDate);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end < start
  ) {
    return 0;
  }

  const diffTime = end.getTime() - start.getTime();
  return Math.max(0, Math.round(diffTime / MS_PER_MONTH));
};

export const monthsToYearsAndMonths = (
  totalMonths: number,
): SeaServiceDuration => {
  const safeTotal = Math.max(0, totalMonths);
  return {
    years: Math.floor(safeTotal / 12),
    months: safeTotal % 12,
    totalMonths: safeTotal,
  };
};

/**
 * Calculates total sea time in years and months.
 */
export const calculateTotalSeaTime = (logs: SeaServiceLike[]) => {
  const totalMonths = logs.reduce(
    (sum, log) => sum + diffMonthsBetween(log.joiningDate, log.tillDate),
    0,
  );

  return monthsToYearsAndMonths(totalMonths);
};

/**
 * Returns a human-readable string for duration.
 */
export const formatDuration = (years: number, months: number) => {
  const parts: string[] = [];

  if (years > 0) {
    parts.push(`${years} year${years === 1 ? '' : 's'}`);
  }
  if (months > 0) {
    parts.push(`${months} month${months === 1 ? '' : 's'}`);
  }

  return parts.join(', ') || '0 months';
};

/**
 * Gets unique vessel types from logs (display labels, de-duplicated case-insensitively).
 */
export const getVesselTypes = (logs: SeaServiceLike[]) => {
  const seen = new Set<string>();
  const types: string[] = [];

  logs.forEach((log) => {
    const label = resolveVesselTypeLabel(log);
    const key = normalizeVesselTypeKey(label);
    if (!key || seen.has(key)) return;
    seen.add(key);
    types.push(label);
  });

  return types;
};

export const getVesselTypeBreakdown = (
  logs: SeaServiceLike[],
): VesselTypeBreakdown[] => {
  const vesselMonths = new Map<string, { label: string; months: number }>();

  logs.forEach((log) => {
    const label = resolveVesselTypeLabel(log);
    const key = normalizeVesselTypeKey(label);
    if (!key) return;

    const months = diffMonthsBetween(log.joiningDate, log.tillDate);
    if (months <= 0) return;

    const existing = vesselMonths.get(key);
    if (existing) {
      existing.months += months;
      return;
    }

    vesselMonths.set(key, { label, months });
  });

  return [...vesselMonths.values()]
    .map(({ label, months }) => {
      const duration = monthsToYearsAndMonths(months);
      return {
        vesselType: label,
        ...duration,
        label: formatDuration(duration.years, duration.months),
      };
    })
    .sort((a, b) => b.totalMonths - a.totalMonths);
};

export const buildSeaServiceExperience = (
  logs: SeaServiceLike[],
): SeaServiceExperience => {
  const total = calculateTotalSeaTime(logs);
  const byVesselType = getVesselTypeBreakdown(logs);
  const experienceLines: string[] = [];

  if (total.totalMonths > 0) {
    experienceLines.push(
      `Total Sea Time: ${formatDuration(total.years, total.months)}`,
    );
  }

  byVesselType.forEach((entry) => {
    experienceLines.push(`${entry.vesselType}: ${entry.label}`);
  });

  if (logs.length > 0) {
    const sorted = [...logs].sort(
      (a, b) =>
        new Date(a.joiningDate || 0).getTime() -
        new Date(b.joiningDate || 0).getTime(),
    );
    const firstRole = sorted[0]?.role;
    const lastRole = sorted[sorted.length - 1]?.role;

    if (firstRole && lastRole && firstRole !== lastRole) {
      experienceLines.push(`Rank Progression: ${firstRole} to ${lastRole}`);
    } else if (lastRole) {
      experienceLines.push(`Current Rank: ${lastRole}`);
    }
  }

  return {
    total: {
      ...total,
      label: formatDuration(total.years, total.months),
    },
    byVesselType,
    experienceLines,
    uniqueVesselTypes: getVesselTypes(logs),
  };
};

/**
 * Generates an experience summary list as seen in UI.
 */
export const getExperienceSummary = (logs: SeaServiceLike[]) =>
  buildSeaServiceExperience(logs).experienceLines;
