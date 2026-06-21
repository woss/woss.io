// src/content/index.ts
// Content collection types

import { parseMarkdownFrontmatter } from '../lib/server/markdown.ts';

export interface ExperienceEntry {
  slug: string;
  company: string;
  role: string;
  startDate: string;
  endDate: string | null;
  duration: string;
  skills: string[];
  description: string;
  excerpt: string;
}

export interface WorkflowFilePlaceholder {
  key: string;
  label: string;
  hint?: string;
}
export interface WorkflowFileEntry {
  label: string;
  file: string;
  placeholders: WorkflowFilePlaceholder[];
}

export interface BlogPost {
  slug: string;
  title: string;
  date: string | null;
  tags: string[];
  excerpt: string;
  body: string; // raw markdown body (frontmatter removed)
  status: string;
  featured?: boolean;
  headerImage?: { alt: string; url: string };
  id?: number;
  partOfSeries?: number;
  workflowFiles?: WorkflowFileEntry[];
}

// Re-export for backward compatibility
export { parseMarkdownFrontmatter as parseFrontmatter };
