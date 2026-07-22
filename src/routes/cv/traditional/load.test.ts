import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock getExperience ────────────────────────────────────────────────
const mockGetExperience = vi.fn();

vi.mock('$lib/server/db', () => ({
  db: { content: { getExperience: mockGetExperience } },
}));

// Import AFTER mock
const { load } = await import('./+page.server');

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────
function makeEntry(overrides: Partial<ReturnType<typeof mockGetExperience>[0]> = {}) {
  return {
    slug: 'test-entry',
    content: '# Test',
    company: 'Test Corp',
    role: 'Engineer',
    startDate: '2023-01',
    endDate: '2023-12',
    duration: '1 year',
    skills: ['TypeScript'],
    description: 'Did stuff',
    published: true,
    ...overrides,
  };
}

// ── Happy path ────────────────────────────────────────────────────────

describe('+page.server.ts load()', () => {
  it('returns { experience } shape with one entry', async () => {
    mockGetExperience.mockReturnValue([makeEntry()]);

    const result = await load();

    expect(result).toHaveProperty('experience');
    expect(Array.isArray(result.experience)).toBe(true);
    expect(result.experience).toHaveLength(1);
  });

  it('maps entry to correct shape (slug, company, role, duration, description, skills)', async () => {
    mockGetExperience.mockReturnValue([makeEntry()]);

    const result = await load();
    const entry = result.experience[0];

    expect(entry).toEqual({
      slug: 'test-entry',
      company: 'Test Corp',
      role: 'Engineer',
      duration: '1 year',
      description: 'Did stuff',
      jobRole: '',
      skills: ['TypeScript'],
    });
  });

  it('sets description to empty string when description is falsy', async () => {
    mockGetExperience.mockReturnValue([makeEntry({ description: '' })]);

    const result = await load();
    expect(result.experience[0].description).toBe('');
  });

  it('includes content string when description is provided', async () => {
    mockGetExperience.mockReturnValue([makeEntry({ description: 'Some description' })]);

    const result = await load();
    expect(result.experience[0].description).toBe('Some description');
  });

  // ── Sorting ─────────────────────────────────────────────────────────

  it('sorts entries by startDate descending', async () => {
    mockGetExperience.mockReturnValue([
      makeEntry({ slug: 'old', startDate: '2020-06' }),
      makeEntry({ slug: 'mid', startDate: '2022-01' }),
      makeEntry({ slug: 'new', startDate: '2024-03' }),
    ]);

    const result = await load();
    expect(result.experience.map((e: { slug: string }) => e.slug)).toEqual(['new', 'mid', 'old']);
  });

  it('places entries with null startDate last', async () => {
    mockGetExperience.mockReturnValue([
      makeEntry({ slug: 'dated', startDate: '2023-01' }),
      makeEntry({ slug: 'nodate', startDate: null }),
      makeEntry({ slug: 'older', startDate: '2022-06' }),
    ]);

    const result = await load();
    const slugs = result.experience.map((e: { slug: string }) => e.slug);
    expect(slugs.slice(0, 2)).toContain('dated');
    expect(slugs.slice(0, 2)).toContain('older');
    expect(slugs[2]).toBe('nodate');
  });

  it('handles all entries having null startDate (stable sort)', async () => {
    mockGetExperience.mockReturnValue([
      makeEntry({ slug: 'a', startDate: null }),
      makeEntry({ slug: 'b', startDate: null }),
    ]);

    // Should not throw; order is stable as both return 0
    const result = await load();
    expect(result.experience).toHaveLength(2);
  });

  // ── Filtering ──────────────────────────────────────────────────────

  it('filters out entries where published === false', async () => {
    mockGetExperience.mockReturnValue([
      makeEntry({ slug: 'pub', published: true }),
      makeEntry({ slug: 'unpub', published: false }),
      makeEntry({ slug: 'also-pub', published: true }),
    ]);

    const result = await load();
    expect(result.experience.map((e: { slug: string }) => e.slug)).toEqual(['pub', 'also-pub']);
  });

  it('includes entries where published is true by default', async () => {
    mockGetExperience.mockReturnValue([makeEntry({ published: true })]);

    const result = await load();
    expect(result.experience).toHaveLength(1);
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  it('returns empty experience array when no entries', async () => {
    mockGetExperience.mockReturnValue([]);

    const result = await load();
    expect(result.experience).toEqual([]);
  });

  it('calls getExperience exactly once per load', async () => {
    mockGetExperience.mockReturnValue([makeEntry()]);
    await load();
    expect(mockGetExperience).toHaveBeenCalledTimes(1);
    expect(mockGetExperience).toHaveBeenCalledWith();
  });

  it('aggregates experience correctly with many entries having overlapping skills', async () => {
    const entries = ['a', 'b', 'c', 'd', 'e'].map((slug) => makeEntry({ slug, skills: [slug, 'common'] }));
    mockGetExperience.mockReturnValue(entries);

    const result = await load();
    expect(result.experience).toHaveLength(5);
  });

  // ── Adversarial ────────────────────────────────────────────────────

  it('handles all entries being unpublished', async () => {
    mockGetExperience.mockReturnValue([
      makeEntry({ slug: 'a', published: false }),
      makeEntry({ slug: 'b', published: false }),
    ]);

    const result = await load();
    expect(result.experience).toEqual([]);
  });
});
