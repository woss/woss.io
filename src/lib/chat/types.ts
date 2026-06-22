export interface Source {
  title: string;
  score: number;
  slug?: string;
  url: string;
  type: 'post' | 'experience';
  chunkCount?: number;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  serverId: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: Source[];
  timestamp: number;
  createdAt: string;
  error?: string;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  reaction?: { type: 'up' | 'down' | 'heart'; reason: string } | null;
  savedReason?: string;
  irrecoverable?: boolean;
  queryType?: string;
  toolCalls?: ToolCallInfo[];
  deletedAt?: string;
  fromCache?: boolean;
}

export interface Chat {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  messageCount: number;
  locked?: boolean;
}
