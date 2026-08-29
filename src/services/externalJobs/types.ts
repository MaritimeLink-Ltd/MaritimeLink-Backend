/** A job sourced from outside the platform, normalized for the frontend. */
export type ExternalJob = {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  description: string;
  salary: string | null;
  postedAt: string | null;
  /** Where the seeker goes to apply — always an off-platform employer/board URL. */
  applyLink: string | null;
  /** Human-readable origin, e.g. "Indeed" or "MaritimeJobs". */
  via: string | null;
  thumbnail: string | null;
  /** Occupational category as published by the source, when it has one. */
  category: string | null;
  /** Employment terms, e.g. "Full-time". */
  employmentType: string | null;
  source: 'external';
  /** Which adapter produced this row. */
  provider: 'serpapi' | 'jsearch' | 'feed';
  /** Relevance against the requesting professional; absent when unranked. */
  matchScore?: number;
  matchReasons?: string[];
  /**
   * True when this job cleared the match threshold for the requesting
   * professional. Drives the "matched to you" vs "more maritime jobs"
   * split in the UI.
   */
  matched?: boolean;
};

/** A single search intent derived from a professional's profile. */
export type ExternalJobQuery = {
  /** Free-text search terms, e.g. "Chief Engineer". */
  q: string;
  /** Optional geographic hint passed to providers that support it. */
  location?: string;
};
