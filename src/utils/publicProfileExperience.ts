/**
 * Experience summary lines for the public profile page.
 *
 * This deliberately mirrors the frontend display util
 * (`src/utils/seaServiceExperience.js` in MaritimeLink-Frontend) rather than reusing
 * `experienceUtils.ts`: the frontend reports day-level precision ("6 years 15 days")
 * while `experienceUtils` rounds to whole months. The public page has to read
 * identically to the professional's own Profile Summary, so the two must agree.
 *
 * `experienceUtils.ts` is left untouched because recruiter-facing screens depend on it.
 *
 * Only derived values leave this module — durations, vessel *types* and the current
 * rank. Exact joining/leaving dates, vessel names and employer names never do.
 */

const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365.25;
const DAYS_PER_MONTH = 30.44;

const GENERIC_VESSEL_TYPE_KEYS = new Set([
  'vessel',
  'none',
  'n/a',
  'na',
  'unknown',
  'other',
]);

export type PublicSeaServiceLog = {
  joiningDate: Date | null;
  tillDate: Date | null;
  vesselType: string | null;
  vesselName: string | null;
  role: string | null;
};

/** Singularises the final word so "Tankers" and "Tanker" collapse to one bucket. */
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

const pluralizeVesselTypeDisplay = (label: string) => {
  const trimmed = String(label || '').trim();
  if (!trimmed) return '';

  const lower = trimmed.toLowerCase();
  if (lower.endsWith('s')) return trimmed;
  if (lower.endsWith('y') && !/[aeiou]y$/i.test(trimmed)) {
    return `${trimmed.slice(0, -1)}ies`;
  }
  return `${trimmed}s`;
};

/** Drops the type when it just repeats the vessel's name (e.g. type and name both "Aurora"). */
const resolveVesselTypeLabel = (log: PublicSeaServiceLog) => {
  const vesselType = String(log.vesselType || '').trim();
  const vesselName = String(log.vesselName || '').trim();
  const typeKey = normalizeVesselTypeKey(vesselType);

  if (!typeKey) return '';
  if (vesselName && normalizeVesselTypeKey(vesselName) === typeKey) return '';
  return vesselType;
};

const diffDaysBetween = (
  joiningDate: Date | null,
  tillDate: Date | null,
): number => {
  if (!joiningDate || !tillDate) return 0;
  const start = new Date(joiningDate).getTime();
  const end = new Date(tillDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.max(0, (end - start) / MS_PER_DAY);
};

const totalDaysToYMD = (totalDays: number) => {
  const safe = Math.max(0, totalDays);
  const years = Math.floor(safe / DAYS_PER_YEAR);
  const remainingDays = safe - years * DAYS_PER_YEAR;
  const months = Math.floor(remainingDays / DAYS_PER_MONTH);
  const days = Math.round(remainingDays - months * DAYS_PER_MONTH);
  return { years, months, days, totalMonths: safe / DAYS_PER_MONTH };
};

/** "3 years 1 month 15 days", omitting zero parts. */
const formatDurationCompact = (years: number, months: number, days: number) => {
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (months > 0) parts.push(`${months} month${months === 1 ? '' : 's'}`);
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  return parts.join(' ') || '0 days';
};

export type PublicExperienceSummary = {
  vesselTypes: string[];
  seaTimeLabel: string | null;
  seaTimeYears: number;
  experienceLines: string[];
};

export const buildPublicExperienceSummary = (
  logs: PublicSeaServiceLog[],
): PublicExperienceSummary => {
  const totalRawDays = logs.reduce(
    (sum, log) => sum + diffDaysBetween(log.joiningDate, log.tillDate),
    0,
  );
  const total = totalDaysToYMD(totalRawDays);
  const totalCompact = formatDurationCompact(
    total.years,
    total.months,
    total.days,
  );

  // Accumulate days per normalised vessel type, keeping the most descriptive label.
  const vesselDays = new Map<string, { label: string; days: number }>();
  logs.forEach((log) => {
    const label = resolveVesselTypeLabel(log);
    const key = normalizeVesselTypeKey(label);
    if (!key) return;

    const days = diffDaysBetween(log.joiningDate, log.tillDate);
    if (days <= 0) return;

    const existing = vesselDays.get(key);
    if (existing) {
      existing.days += days;
      if (label.length > existing.label.length) existing.label = label;
      return;
    }
    vesselDays.set(key, { label, days });
  });

  const byVesselType = [...vesselDays.values()]
    .map(({ label, days }) => {
      const duration = totalDaysToYMD(days);
      return {
        vesselType: label,
        totalMonths: duration.totalMonths,
        label: formatDurationCompact(
          duration.years,
          duration.months,
          duration.days,
        ),
      };
    })
    .sort((a, b) => b.totalMonths - a.totalMonths);

  const experienceLines: string[] = [];
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
    const lastRole = sorted[sorted.length - 1]?.role;
    if (lastRole) experienceLines.push(`Current Rank: ${lastRole}`);
  }

  return {
    vesselTypes: byVesselType.map((entry) => entry.vesselType),
    seaTimeLabel: total.totalMonths > 0 ? totalCompact : null,
    seaTimeYears: total.years,
    experienceLines,
  };
};
