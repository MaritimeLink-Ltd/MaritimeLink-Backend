import { scoreProfessionalForJob } from '../utils/jobMatching.js';

describe('jobMatching stop word filtering', () => {
  it('does not score generic job title words as candidate matches', () => {
    const score = scoreProfessionalForJob(
      {
        title: 'Job Test',
        description: 'Job test role',
        location: 'Global',
        category: 'OFFICER',
      },
      {
        fullname: 'Job Test Candidate',
        email: 'job-test-candidate@example.com',
        profession: 'RATINGS_AND_CREW',
        isVerified: false,
        status: 'PENDING',
        resume: {
          category: 'RATINGS_AND_CREW',
          subcategory: 'Deck Rating',
          summary: 'General profile',
          skills: [{ skillName: 'Navigation' }],
          seaService: [],
        },
      },
    );

    expect(score.score).toBe(0);
    expect(score.keywordMatches).toEqual([]);
    expect(score.criteria).toEqual([]);
  });
});

describe('jobMatching category matching', () => {
  const candidate = {
    fullname: 'Ada Mariner',
    email: 'ada@example.com',
    profession: null,
    isVerified: false,
    status: 'PENDING',
    resume: {
      category: null,
      subcategory: null,
      summary: null,
      skills: [],
      seaService: [],
    },
  };

  // Externally-sourced listings can arrive with no category. Without a guard,
  // "" === "" counted as an exact category match and handed out 40 points.
  it('does not treat two missing categories as a category match', () => {
    const result = scoreProfessionalForJob(
      { title: 'Able Seaman', description: '', location: '', category: null },
      candidate,
    );

    expect(result.exactCategoryMatch).toBe(false);
    expect(result.criteria).not.toContain('Category match');
  });

  it('still scores a real category match', () => {
    const result = scoreProfessionalForJob(
      {
        title: 'Able Seaman',
        description: '',
        location: '',
        category: 'OFFICER',
      },
      { ...candidate, profession: 'OFFICER' },
    );

    expect(result.exactCategoryMatch).toBe(true);
    expect(result.criteria).toContain('Category match');
  });
});
