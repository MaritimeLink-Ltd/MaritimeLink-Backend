import { jest } from '@jest/globals';
import { ExternalJob } from '../services/externalJobs/types.js';

const job = (id: string): ExternalJob => ({
  id,
  title: 'Chief Engineer',
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

const fetchGreenhouseJobs =
  jest.fn<(id: string, label?: string) => Promise<ExternalJob[]>>();
const fetchLeverJobs =
  jest.fn<(id: string, label?: string) => Promise<ExternalJob[]>>();
const fetchSmartRecruitersJobs =
  jest.fn<(id: string, label?: string) => Promise<ExternalJob[]>>();
const fetchWorkdayJobs =
  jest.fn<(url: string, label?: string) => Promise<ExternalJob[]>>();

jest.unstable_mockModule('../services/externalJobs/ats/greenhouse.js', () => ({
  fetchGreenhouseJobs,
}));
jest.unstable_mockModule('../services/externalJobs/ats/lever.js', () => ({
  fetchLeverJobs,
}));
jest.unstable_mockModule(
  '../services/externalJobs/ats/smartrecruiters.js',
  () => ({
    fetchSmartRecruitersJobs,
  }),
);
jest.unstable_mockModule('../services/externalJobs/ats/workday.js', () => ({
  fetchWorkdayJobs,
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
    fetchGreenhouseJobs.mockResolvedValueOnce([job('greenhouse:acme:1')]);
    fetchLeverJobs.mockResolvedValueOnce([job('lever:globex:1')]);

    const jobs = await fetchAtsJobs();

    expect(fetchGreenhouseJobs).toHaveBeenCalledWith('acme', 'Acme Shipping');
    expect(fetchLeverJobs).toHaveBeenCalledWith('globex', undefined);
    expect(jobs.map((j) => j.id)).toEqual([
      'greenhouse:acme:1',
      'lever:globex:1',
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
});
