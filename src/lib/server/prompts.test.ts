import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
  env: {
    ORIGIN: 'http://localhost:5173',
    PROVIDER_API_KEY: 'test-key',
    LLM_PROVIDER_BASE_URL: 'http://localhost:1234/v1',
    MAIN_MODEL: 'test-model',
    MAX_TOKENS: '',
    FIRST_ROUND_MAX_STEPS: '',
    MAX_ROUNDS: '',
    MAX_RESULTS_LENGTH: '',
    TOOL_CLASSIFY_TIMEOUT_MS: '',
    MCP_SERVERS: '[]',
    LLM_CACHE_ENABLED: '',
    WOSS_USER_WEBHOOK_URL: '',
    WOSS_USER_WEBHOOK_TOKEN: '',
    WOSS_USER_WEBHOOK_ERROR_URL: '',
  },
}));

import {
  getSystemPrompt,
  getToolSystemPrompt,
  getRelevanceCheckUserPrompt,
  getRelevanceCheckSystemPrompt,
  getPoliteResponseSystemPrompt,
  getToolClassifierUserPrompt,
  getToolClassifierSystemPrompt,
  getDoomLoopRecoveryPrompt,
} from './prompts.ts';

describe('prompts', () => {
  it('getSystemPrompt matches snapshot', () => {
    expect(getSystemPrompt()).toMatchSnapshot();
  });

  describe('getToolSystemPrompt', () => {
    it('default (both true) matches snapshot', () => {
      expect(getToolSystemPrompt()).toMatchSnapshot();
    });

    it('github only matches snapshot', () => {
      expect(getToolSystemPrompt({ macula: false })).toMatchSnapshot();
    });

    it('macula only matches snapshot', () => {
      expect(getToolSystemPrompt({ github: false })).toMatchSnapshot();
    });

    it('neither matches snapshot', () => {
      expect(getToolSystemPrompt({ github: false, macula: false })).toMatchSnapshot();
    });
  });

  describe('getRelevanceCheckUserPrompt', () => {
    it('without context matches snapshot', () => {
      expect(getRelevanceCheckUserPrompt('What is your experience with React?')).toMatchSnapshot();
    });

    it('with context matches snapshot', () => {
      expect(
        getRelevanceCheckUserPrompt('Tell me more', 'Daniel has experience with React, TypeScript, and SvelteKit'),
      ).toMatchSnapshot();
    });
  });

  it('getRelevanceCheckSystemPrompt matches snapshot', () => {
    expect(getRelevanceCheckSystemPrompt()).toMatchSnapshot();
  });

  it('getPoliteResponseSystemPrompt matches snapshot', () => {
    expect(getPoliteResponseSystemPrompt()).toMatchSnapshot();
  });

  describe('getToolClassifierUserPrompt', () => {
    it('without context matches snapshot', () => {
      expect(getToolClassifierUserPrompt('show repos')).toMatchSnapshot();
    });

    it('with context matches snapshot', () => {
      expect(getToolClassifierUserPrompt('show repos', "User asked about Daniel's projects")).toMatchSnapshot();
    });
  });

  it('getToolClassifierSystemPrompt matches snapshot', () => {
    expect(getToolClassifierSystemPrompt()).toMatchSnapshot();
  });

  it('getDoomLoopRecoveryPrompt matches snapshot', () => {
    expect(getDoomLoopRecoveryPrompt()).toMatchSnapshot();
  });
});
