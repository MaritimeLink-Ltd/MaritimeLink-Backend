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

const GENERIC_VESSEL_TYPE_KEYS = new Set([
  'vessel',
  'none',
  'n/a',
  'na',
  'unknown',
  'other',
]);

const normalizeVesselTypeKey = (value?: string | null) => {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  if (!key || GENERIC_VESSEL_TYPE_KEYS.has(key)) return '';

  const words = key.split(' ');
  const last = words[words.length - 1];

  if (last.endsWith('ies') && last.length > 4) {
    words[words.length - 1] = `${last.slice(0, -3)}y`;
  } else if (last.endsWith('es') && last.length > 3 && !last.endsWith('ss')) {
    words[words.length - 1] = last.slice(0, -2);
  } else if (last.endsWith('s') && last.length > 2 && !last.endsWith('ss')) {
    words[words.length - 1] = last.slice(0, -1);
  }

  return words.join(' ');
};

const displayVesselType = (value?: string | null) => String(value || '').trim();

const resolveVesselTypeLabel = (log: SeaServiceLike) => {
  const vesselType = displayVesselType(log.vesselType);
  const vesselName = displayVesselType(log.vesselName);
  const typeKey = normalizeVesselTypeKey(vesselType);

  if (!typeKey) return '';

  if (vesselName && normalizeVesselTypeKey(vesselName) === typeKey) {
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

export const formatDurationCompact = (years: number, months: number) => {
  const parts: string[] = [];

  if (years > 0) {
    parts.push(`${years} year${years === 1 ? '' : 's'}`);
  }
  if (months > 0) {
    parts.push(`${months} month${months === 1 ? '' : 's'}`);
  }

  return parts.join(' ') || '0 months';
};

/**
 * Returns a human-readable string for duration (comma-separated).
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

export const pluralizeVesselTypeDisplay = (label: string) => {
  const trimmed = displayVesselType(label);
  if (!trimmed) return '';

  const lower = trimmed.toLowerCase();
  if (lower.endsWith('s')) return trimmed;

  if (lower.endsWith('y') && !/[aeiou]y$/i.test(trimmed)) {
    return `${trimmed.slice(0, -1)}ies`;
  }

  return `${trimmed}s`;
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
      if (label.length > existing.label.length) {
        existing.label = label;
      }
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
        label: formatDurationCompact(duration.years, duration.months),
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
  const totalCompact = formatDurationCompact(total.years, total.months);

  if (total.totalMonths > 0) {
    experienceLines.push(`${totalCompact} total sea service`);
  }

  byVesselType.forEach((entry) => {
    experienceLines.push(
      `${entry.label} on ${pluralizeVesselTypeDisplay(entry.vesselType)}`,
    );
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
      label: totalCompact,
    },
    byVesselType,
    experienceLines,
    uniqueVesselTypes: byVesselType.map((entry) => entry.vesselType),
  };
};

/**
 * Generates an experience summary list as seen in UI.
 */
export const getExperienceSummary = (logs: SeaServiceLike[]) =>
  buildSeaServiceExperience(logs).experienceLines;
