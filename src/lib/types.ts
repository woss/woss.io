/**
 * Shared view-model types returned by route load functions.
 *
 * These are the shapes the list pages hand to their components — derived
 * from the DB result types in `$lib/server/db-service` but normalized for
 * rendering (optional fields resolved, DB integers kept as-is).
 */

export interface BlogPost {
  slug: string;
  title: string;
  date: string | null;
  tags: string[];
  excerpt: string;
  body: string;
  status: string;
  featured: boolean;
  headerImage?: string;
  /** Series-root post id when this post belongs to a series. */
  partOfSeries?: number;
}

export interface ExperienceEntry {
  slug: string;
  company: string;
  role: string;
  startDate: string | null;
  endDate: string | null;
  duration: string;
  skills: string[];
  description: string;
  excerpt: string;
}
