import { ProfessionalSeaServiceLog } from '../generated/client/index.js';

/**
 * Calculates total sea time in years and months.
 */
export const calculateTotalSeaTime = (logs: ProfessionalSeaServiceLog[]) => {
  let totalMonths = 0;

  logs.forEach((log) => {
    if (log.joiningDate && log.tillDate) {
      const start = new Date(log.joiningDate);
      const end = new Date(log.tillDate);

      const diffTime = Math.abs(end.getTime() - start.getTime());
      const diffMonths = Math.round(diffTime / (1000 * 60 * 60 * 24 * 30.44));
      totalMonths += diffMonths;
    }
  });

  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;

  return { years, months, totalMonths };
};

/**
 * Returns a human-readable string for duration.
 */
export const formatDuration = (years: number, months: number) => {
  const yStr = years > 0 ? `${years} year${years > 1 ? 's' : ''}` : '';
  const mStr = months > 0 ? `${months} month${months > 1 ? 's' : ''}` : '';

  if (yStr && mStr) return `${yStr} ${mStr}`;
  return yStr || mStr || '0 months';
};

/**
 * Gets unique vessel types from logs.
 */
export const getVesselTypes = (logs: ProfessionalSeaServiceLog[]) => {
  const types = new Set<string>();
  logs.forEach((log) => {
    if (log.vesselType) types.add(log.vesselType);
  });
  return Array.from(types);
};

/**
 * Generates an experience summary list as seen in UI.
 */
export const getExperienceSummary = (logs: ProfessionalSeaServiceLog[]) => {
  const summary: string[] = [];
  const { years, months } = calculateTotalSeaTime(logs);

  if (years > 0 || months > 0) {
    summary.push(`${formatDuration(years, months)} total sea service`);
  }

  // Vessel type breakdown
  const vesselTime: Record<string, number> = {};
  logs.forEach((log) => {
    if (log.vesselType && log.joiningDate && log.tillDate) {
      const diff =
        new Date(log.tillDate).getTime() - new Date(log.joiningDate).getTime();
      vesselTime[log.vesselType] = (vesselTime[log.vesselType] || 0) + diff;
    }
  });

  Object.entries(vesselTime).forEach(([type, ms]) => {
    const totalM = Math.ceil(ms / (1000 * 60 * 60 * 24 * 30.44));
    const y = Math.floor(totalM / 12);
    const m = totalM % 12;
    summary.push(`${formatDuration(y, m)} on ${type}s`);
  });

  // Rank progression (Simplified: first and last role)
  if (logs.length > 0) {
    const sorted = [...logs].sort(
      (a, b) =>
        new Date(a.joiningDate!).getTime() - new Date(b.joiningDate!).getTime(),
    );
    const firstRole = sorted[0].role;
    const lastRole = sorted[sorted.length - 1].role;

    if (firstRole && lastRole && firstRole !== lastRole) {
      summary.push(`Rank Progression: ${firstRole} to ${lastRole}`);
    } else if (lastRole) {
      summary.push(`Current Rank: ${lastRole}`);
    }
  }

  return summary;
};
