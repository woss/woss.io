/**
 * LLM event types for streaming with Vercel AI SDK + Effect.ts.
 */
export type LLMEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-input-delta'; id: string; name: string; text: string }
  | { type: 'tool-call'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; name: string; result: unknown }
  | { type: 'step-finish'; reason: FinishReason; toolCalls: number; textProduced: boolean; usage?: TokenUsage }
  | {
      type: 'finish';
      reason: FinishReason;
      usage?: TokenUsage;
      modelName: string;
      actualModelName: string;
      provider: string;
      maxTokens: number;
      toolLoopDetected?: boolean;
    };

export type FinishReason = 'stop' | 'tool-calls' | 'error' | 'length' | 'unknown';

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};
