import {
  buildSeaServiceExperience,
  calculateTotalSeaTime,
  getVesselTypeBreakdown,
} from '../utils/experienceUtils.js';

const sampleLogs = [
  {
    companyName: 'Maritime Corp',
    role: 'Second Officer',
    vesselName: 'LNG Lagos 2',
    vesselType: 'LNG Tanker',
    joiningDate: new Date('2020-01-01'),
    tillDate: new Date('2022-01-01'),
  },
  {
    companyName: 'Oceanic Ltd',
    role: 'Chief Officer',
    vesselName: 'Support One',
    vesselType: 'LNG Tanker',
    joiningDate: new Date('2022-02-01'),
    tillDate: new Date('2023-02-01'),
  },
  {
    companyName: 'Offshore Co',
    role: 'Chief Officer',
    vesselName: 'OSV Pioneer',
    vesselType: 'Offshore Support Vessel',
    joiningDate: new Date('2023-03-01'),
    tillDate: new Date('2024-03-01'),
  },
];

describe('experienceUtils', () => {
  it('calculates total sea time across all records', () => {
    const total = calculateTotalSeaTime(sampleLogs);
    expect(total.totalMonths).toBeGreaterThan(0);
    expect(total.years).toBeGreaterThan(0);
  });

  it('groups duplicate vessel types and sums their time', () => {
    const breakdown = getVesselTypeBreakdown(sampleLogs);
    expect(breakdown).toHaveLength(2);
    expect(breakdown.map((entry) => entry.vesselType)).toEqual([
      'LNG Tanker',
      'Offshore Support Vessel',
    ]);
  });

  it('builds Figma-style experience lines', () => {
    const experience = buildSeaServiceExperience(sampleLogs);
    expect(experience.experienceLines[0]).toMatch(/^Total Sea Time:/);
    expect(
      experience.experienceLines.some((line) => line.startsWith('LNG Tanker:')),
    ).toBe(true);
    expect(
      experience.experienceLines.some((line) =>
        line.startsWith('Offshore Support Vessel:'),
      ),
    ).toBe(true);
    expect(experience.uniqueVesselTypes).toHaveLength(2);
  });
});
