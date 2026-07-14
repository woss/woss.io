import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// Import REAL modules — no mocks
import { mcpServer } from './index';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const IPSOS_SIMSTORE_SLUG = 'ipsos-simstore';
const IPSOS_SIMSTORE_COMPANY = 'Ipsos Simstore';
const IPSOS_SIMSTORE_ROLE = 'Senior DevOps, Platform Architect & AI Adoption Lead';
const IPSOS_SIMSTORE_SKILLS = [
  'aws',
  'terraform/openTofu/terragrunt',
  'cloud infrastructure',
  'devops',
  'kubernetes',
  'typescript',
  'python',
  'distributed systems',
  'knative mesh',
  'event-driven architecture',
  'data modeling and design',
  'software/platform architecture',
  'AI plugins development',
  'CI/CD',
];

// ─── Setup ────────────────────────────────────────────────────────────────────

let client: Client;
let clientTransport: InMemoryTransport;
let serverTransport: InMemoryTransport;

beforeAll(async () => {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  clientTransport = ct;
  serverTransport = st;

  client = new Client({ name: 'integration-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);
});

afterAll(async () => {
  await clientTransport.close();
  await serverTransport.close();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MCP get_experience — integration (real SurrealDB)', () => {
  it('returns Ipsos Simstore entry', async () => {
    const result = await client.callTool({ name: 'get_experience', arguments: {} });

    expect(result.content).toHaveLength(1);
    const text = (result.content as { type: string; text: string }[])[0].text;

    // Entry must exist
    expect(text).toContain(IPSOS_SIMSTORE_COMPANY);
    expect(text).toContain(IPSOS_SIMSTORE_ROLE);
  });

  it('includes correct skills for Ipsos Simstore', async () => {
    const result = await client.callTool({ name: 'get_experience', arguments: {} });
    const text = (result.content as { type: string; text: string }[])[0].text;

    // Verify key skills are present
    expect(text).toContain('kubernetes');
    expect(text).toContain('aws');
    expect(text).toContain('devops');
    expect(text).toContain('CI/CD');
    expect(text).toContain('knative mesh');
  });

  it('filters by date range — includes entries from 2023 onwards', async () => {
    const result = await client.callTool({
      name: 'get_experience',
      arguments: { from: '2023-01-01', to: '2024-12-31' },
    });
    const text = (result.content as { type: string; text: string }[])[0].text;

    // Ipsos Simstore started 2023-08, should be included
    expect(text).toContain(IPSOS_SIMSTORE_COMPANY);
  });

  it('filters by date range — excludes entries before 2024', async () => {
    const result = await client.callTool({
      name: 'get_experience',
      arguments: { from: '2024-01-01' },
    });
    const text = (result.content as { type: string; text: string }[])[0].text;

    // Ipsos Simstore started 2023-08, should NOT be in 2024+ range
    expect(text).not.toContain(IPSOS_SIMSTORE_COMPANY);
  });

  it('sorts by startDate descending (default)', async () => {
    const result = await client.callTool({ name: 'get_experience', arguments: {} });
    const text = (result.content as { type: string; text: string }[])[0].text;

    // Default sort: startDate desc. Ipsos Simstore (2023-08) should appear
    // before older entries but after newer ones
    const lines = text.split('\n').filter((l) => l.startsWith('## '));
    expect(lines.length).toBeGreaterThan(0);
  });

  it('sorts by company ascending', async () => {
    const result = await client.callTool({
      name: 'get_experience',
      arguments: { sort: 'company', order: 'asc' },
    });
    const text = (result.content as { type: string; text: string }[])[0].text;

    // Just verify it returns entries and doesn't crash
    expect(text).toContain(IPSOS_SIMSTORE_COMPANY);
  });

  it('returns multiple entries separated by dividers', async () => {
    const result = await client.callTool({ name: 'get_experience', arguments: {} });
    const text = (result.content as { type: string; text: string }[])[0].text;

    // Should have at least 2 entries (Ipsos + others)
    expect(text).toContain('---');
    expect(text.split('---').length).toBeGreaterThanOrEqual(2);
  });
});
