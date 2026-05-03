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
