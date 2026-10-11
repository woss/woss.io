import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMcpServers } from './config';

afterEach(() => {
  delete process.env.MCP_TEST_TOKEN;
  delete process.env.MCP_MISSING_TOKEN;
  vi.restoreAllMocks();
});

describe('parseMcpServers', () => {
  it('returns no servers for empty configuration', () => {
    expect(parseMcpServers(undefined)).toEqual([]);
    expect(parseMcpServers('')).toEqual([]);
  });

  it('substitutes environment values and filters disabled servers', () => {
    process.env.MCP_TEST_TOKEN = 'test-token';

    expect(
      parseMcpServers(
        '[{"id":"enabled","url":"https://example.test","token":"$MCP_TEST_TOKEN"},{"id":"disabled","url":"https://disabled.test","token":"public","enabled":false}]',
      ),
    ).toEqual([{ id: 'enabled', url: 'https://example.test', token: 'test-token' }]);
  });

  it('fails on unresolved environment variables without writing to console', () => {
    delete process.env.MCP_MISSING_TOKEN;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() =>
      parseMcpServers('[{"id":"missing","url":"https://example.test","token":"$MCP_MISSING_TOKEN"}]'),
    ).toThrow('MCP_SERVERS contains unresolved environment variables: MCP_MISSING_TOKEN');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
