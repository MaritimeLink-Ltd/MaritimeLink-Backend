import { fetchFeedJobs } from '../src/services/externalJobs/feedSource.js';
import {
  fetchSerpApiJobs,
  resolveSerpApiKeys,
} from '../src/services/externalJobs/serpApiSource.js';
import { isInMaritimeScope } from '../src/services/externalJobs/scope.js';

const main = async () => {
  console.log('--- feed source ---');
  const feedJobs = await fetchFeedJobs();
  console.log('feed jobs:', feedJobs.length);
  console.log(JSON.stringify(feedJobs.slice(0, 2), null, 2));

  console.log('\n--- serpapi source ---');
  // Spends one search from the first configured key. The real refresh pools
  // every key instead (see externalJobs/apiKeyPool.ts); this is a single
  // manual probe, so the first key is enough.
  const [serpApiKey] = resolveSerpApiKeys();
  if (!serpApiKey) throw new Error('No SERPAPI_KEY configured');

  const serpJobs = await fetchSerpApiJobs(
    { q: 'Chief Engineer maritime' },
    serpApiKey,
  );
  console.log('serpapi jobs:', serpJobs.length);
  console.log(
    serpJobs.slice(0, 3).map((job) => ({
      title: job.title,
      company: job.company,
      location: job.location,
      hasApplyLink: Boolean(job.applyLink),
    })),
  );

  console.log('\n--- maritime scope filter ---');
  const rejected = serpJobs.filter((job) => !isInMaritimeScope(job));
  console.log(
    `in scope: ${serpJobs.length - rejected.length}/${serpJobs.length}`,
  );
  console.log(
    'rejected:',
    rejected.map((job) => `${job.title} @ ${job.company}`),
  );
};

main().catch((error) => {
  console.error('FAILED:', error);
  process.exit(1);
});
