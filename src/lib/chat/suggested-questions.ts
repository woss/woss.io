// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Classifier label for a seed query */
export type QueryClass = 'tool' | 'rag' | 'hybrid' | 'meta';

/** A seed query with its classification label */
export interface SeedQuery {
  text: string;
  class: QueryClass;
  suggested?: number;
}

// ---------------------------------------------------------------------------
// Suggested questions — shown as prompts on the front page
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Seed queries — representative examples for centroid classifier training
// ---------------------------------------------------------------------------

export const SEED_QUERIES: SeedQuery[] = [
  // Tool queries
  { text: "Search GitHub for Daniel's repositories", class: 'tool' },
  { text: "Find Daniel's open issues on GitHub", class: 'tool' },
  { text: 'What commits has Daniel made', class: 'tool' },
  { text: 'How many stars does woss-io have', class: 'tool' },
  { text: 'Show me the open issues on woss.io', class: 'tool' },
  { text: 'Who contributed to woss-io recently', class: 'tool' },

  // RAG queries
  { text: 'Tell me about Daniel', class: 'rag', suggested: 1 },
  { text: "Describe Daniel's work experience", class: 'rag' },
  { text: "Show me Daniel's latest posts", class: 'rag' },
  { text: 'Show me posts', class: 'rag' },
  { text: "Show me Daniel's posts", class: 'rag' },
  { text: 'What projects has Daniel founded?', class: 'rag', suggested: 4 },
  { text: 'What skills and technologies does Daniel use', class: 'rag' },
  { text: 'Tell me about woss.io', class: 'rag' },
  { text: "Tell me about Daniel's experience with copyrights and IP?", class: 'rag', suggested: 5 },
  { text: 'What DevOps and cloud experience does Daniel have?', class: 'rag', suggested: 6 },

  // Personal development queries
  { text: 'How has Daniel grown as a software developer', class: 'rag' },
  { text: 'What did Daniel learn building Anagolay Network', class: 'rag' },
  { text: 'What did Daniel learn building Macula', class: 'rag' },
  { text: 'What did Daniel learn building Woss.io', class: 'rag' },
  { text: "Tell me about Daniel's entrepreneurial journey", class: 'rag' },
  { text: 'What leadership lessons did Daniel learn at Kelp Digital', class: 'rag' },
  { text: "How did Daniel's platform engineering skills grow at Ipsos", class: 'rag' },
  { text: 'What did Daniel learn from being a digital nomad', class: 'rag' },
  { text: 'How did Daniel develop his data visualization skills', class: 'rag' },
  { text: 'What did Daniel learn from his first startup at Biddl', class: 'rag' },

  // Hybrid queries
  { text: "Show me Daniel's portfolio", class: 'hybrid', suggested: 2 },
  { text: "Show me Daniel's AI projects and implementations", class: 'hybrid', suggested: 3 },
  { text: "Daniel's experience and his recent PRs", class: 'hybrid' },
  { text: 'What open source projects has Daniel contributed to', class: 'hybrid' },
  { text: 'Tell me about Daniel and his GitHub activity', class: 'hybrid' },
  { text: 'What grants has Daniel received', class: 'hybrid' },

  // Meta queries (about the AI assistant itself — answered from system prompt)
  { text: 'who is haistlin?', class: 'meta' },
  { text: 'what is haistlin?', class: 'meta' },
  { text: 'tell me about haistlin', class: 'meta' },
  { text: 'who are you?', class: 'meta' },
  { text: 'what is your name?', class: 'meta' },
  { text: 'explain the name haistlin', class: 'meta' },
  { text: 'tell me about yourself', class: 'meta' },
  { text: 'what do you do?', class: 'meta' },
];

export const SUGGESTED_QUESTIONS: string[] = SEED_QUERIES.filter((q) => q.suggested).map((q) => q.text);
