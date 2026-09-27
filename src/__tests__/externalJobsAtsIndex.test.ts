import { jest } from '@jest/globals';
import { ExternalJob } from '../services/externalJobs/types.js';

const job = (id: string, title = 'Second Engineer'): ExternalJob => ({
  id,
  title,
  company: 'Acme',
  location: null,
  description: '',
  salary: null,
  postedAt: null,
  applyLink: null,
  via: null,
  thumbnail: null,
  category: null,
  employmentType: null,
  source: 'external',
  provider: 'greenhouse',
});

const mockEnv: Record<string, string | undefined> = {};
jest.unstable_mockModule('../config/env.js', () => ({ env: mockEnv }));

type Fetch = (id: string, label?: string) => Promise<ExternalJob[]>;
const fetchGreenhouseJobs = jest.fn<Fetch>();
const fetchLeverJobs = jest.fn<Fetch>();
const fetchSmartRecruitersJobs =
  jest.fn<
    (
      id: string,
      label?: string,
      keep?: (jobs: ExternalJob[]) => ExternalJob[],
    ) => Promise<ExternalJob[]>
  >();
const fetchWorkdayJobs = jest.fn<Fetch>();
const fetchPinpointJobs = jest.fn<Fetch>();
const fetchTeamtailorJobs = jest.fn<Fetch>();
const fetchRecruiteeJobs = jest.fn<Fetch>();

jest.unstable_mockModule('../services/externalJobs/ats/greenhouse.js', () => ({
  fetchGreenhouseJobs,
}));
jest.unstable_mockModule('../services/externalJobs/ats/lever.js', () => ({
  fetchLeverJobs,
}));
jest.unstable_mockModule(
  '../services/externalJobs/ats/smartrecruiters.js',
  () => ({ fetchSmartRecruitersJobs }),
);
jest.unstable_mockModule('../services/externalJobs/ats/workday.js', () => ({
  fetchWorkdayJobs,
}));
jest.unstable_mockModule('../services/externalJobs/ats/pinpoint.js', () => ({
  fetchPinpointJobs,
}));
jest.unstable_mockModule('../services/externalJobs/ats/teamtailor.js', () => ({
  fetchTeamtailorJobs,
}));
jest.unstable_mockModule('../services/externalJobs/ats/recruitee.js', () => ({
  fetchRecruiteeJobs,
}));

const { fetchAtsJobs, isAnyAtsSourceConfigured } =
  await import('../services/externalJobs/ats/index.js');

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
});

describe('fetchAtsJobs', () => {
  it('returns nothing when no platform has a company configured', async () => {
    const jobs = await fetchAtsJobs();
    expect(jobs).toEqual([]);
    expect(fetchGreenhouseJobs).not.toHaveBeenCalled();
  });

  it('fans out to every configured platform and flattens the results', async () => {
    mockEnv.ATS_GREENHOUSE_BOARDS = 'acme:Acme Shipping';
    mockEnv.ATS_LEVER_COMPANIES = 'globex';
    mockEnv.ATS_PINPOINT_COMPANIES = 'vgroup:V.Group';
    mockEnv.ATS_TEAMTAILOR_COMPANIES = 'northstarshipping:North Star Shipping';
    mockEnv.ATS_RECRUITEE_COMPANIES = 'windcat:Windcat';
    fetchGreenhouseJobs.mockResolvedValueOnce([job('greenhouse:acme:1')]);
    fetchLeverJobs.mockResolvedValueOnce([job('lever:globex:1')]);
    fetchPinpointJobs.mockResolvedValueOnce([job('pinpoint:vgroup:1')]);
    fetchTeamtailorJobs.mockResolvedValueOnce([
      job('teamtailor:northstarshipping:1'),
    ]);
    fetchRecruiteeJobs.mockResolvedValueOnce([job('recruitee:windcat:1')]);

    const jobs = await fetchAtsJobs();

    expect(fetchGreenhouseJobs).toHaveBeenCalledWith('acme', 'Acme Shipping');
    expect(fetchLeverJobs).toHaveBeenCalledWith('globex', undefined);
    expect(fetchPinpointJobs).toHaveBeenCalledWith('vgroup', 'V.Group');
    expect(fetchTeamtailorJobs).toHaveBeenCalledWith(
      'northstarshipping',
      'North Star Shipping',
    );
    expect(fetchRecruiteeJobs).toHaveBeenCalledWith('windcat', 'Windcat');
    expect(jobs.map((j) => j.id)).toEqual([
      'greenhouse:acme:1',
      'lever:globex:1',
      'pinpoint:vgroup:1',
      'teamtailor:northstarshipping:1',
      'recruitee:windcat:1',
    ]);
  });

  it('isolates a failing company so one bad source does not drop the rest', async () => {
    mockEnv.ATS_GREENHOUSE_BOARDS = 'broken,acme';
    fetchGreenhouseJobs
      .mockRejectedValueOnce(new Error('board not found'))
      .mockResolvedValueOnce([job('greenhouse:acme:1')]);

    const jobs = await fetchAtsJobs();

    expect(jobs.map((j) => j.id)).toEqual(['greenhouse:acme:1']);
  });

  it('drops standing talent-pool entries — there is no vacancy to apply to', async () => {
    // Seen live on Stena's board next to its two real openings.
    mockEnv.ATS_TEAMTAILOR_COMPANIES = 'stena';
    fetchTeamtailorJobs.mockResolvedValueOnce([
      job('teamtailor:stena:1', 'Junior Officers Deck'),
      job('teamtailor:stena:2', 'Seafarer Talent Pool Registration'),
      job('teamtailor:stena:3', 'Student Talent Pool Registration'),
    ]);

    const jobs = await fetchAtsJobs();

    expect(jobs.map((j) => j.id)).toEqual(['teamtailor:stena:1']);
  });

  it('keeps only maritime-titled postings from a corporate board', async () => {
    // Shape of Boskalis's live board: mostly office and construction roles.
    mockEnv.ATS_PINPOINT_COMPANIES = 'corp';
    fetchPinpointJobs.mockResolvedValueOnce([
      job('pinpoint:corp:1', 'Vessel Manager'),
      ...Array.from({ length: 9 }, (_, i) =>
        job(`pinpoint:corp:office${i}`, 'Senior Accountant'),
      ),
    ]);

    const jobs = await fetchAtsJobs();

    expect(jobs.map((j) => j.id)).toEqual(['pinpoint:corp:1']);
  });

  it('keeps a seagoing board whole, including crew posts titled with just the rank', async () => {
    // Shape of Svitzer's live board: a bare "Master"/"Captain" is a real crew post.
    mockEnv.ATS_PINPOINT_COMPANIES = 'tugs';
    fetchPinpointJobs.mockResolvedValueOnce([
      job('pinpoint:tugs:1', 'Tug Master'),
      job('pinpoint:tugs:2', 'Second Engineer'),
      job('pinpoint:tugs:3', 'Master'),
    ]);

    const jobs = await fetchAtsJobs();

    expect(jobs).toHaveLength(3);
  });

  it('applies the board filter before SmartRecruiters spends detail requests', async () => {
    mockEnv.ATS_SMARTRECRUITERS_COMPANIES = 'boskalis:Boskalis';
    fetchSmartRecruitersJobs.mockResolvedValueOnce([]);

    await fetchAtsJobs();

    const keep = fetchSmartRecruitersJobs.mock.calls[0][2]!;
    expect(
      keep([
        job('smartrecruiters:boskalis:1', 'Vessel Manager'),
        ...Array.from({ length: 9 }, (_, i) =>
          job(`smartrecruiters:boskalis:office${i}`, 'Financial Controller'),
        ),
      ]).map((j) => j.id),
    ).toEqual(['smartrecruiters:boskalis:1']);
  });
});

describe('isAnyAtsSourceConfigured', () => {
  it('is false when every platform env var is unset', () => {
    expect(isAnyAtsSourceConfigured()).toBe(false);
  });

  it('is true once any single platform has a value', () => {
    mockEnv.ATS_WORKDAY_CAREER_SITES =
      'https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/External';
    expect(isAnyAtsSourceConfigured()).toBe(true);
  });

  it('counts the newer platforms too', () => {
    mockEnv.ATS_RECRUITEE_COMPANIES = 'windcat';
    expect(isAnyAtsSourceConfigured()).toBe(true);
  });
});
