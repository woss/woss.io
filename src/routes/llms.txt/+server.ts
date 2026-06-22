import { getExperience } from '$lib/server/db';

function formatMeta(meta: Record<string, unknown>): string[] {
  const lines: string[] = [];

  for (const [key, val] of Object.entries(meta)) {
    if (val === '' || val === undefined) continue;

    if (val === null) {
      lines.push(`${key}: null`);
    } else if (Array.isArray(val)) {
      lines.push(`${key}:`);
      for (const item of val) {
        if (typeof item === 'object' && item !== null) {
          const entries = Object.entries(item);
          if (entries.length > 0) {
            const [firstKey, firstVal] = entries[0];
            lines.push(`  - ${firstKey}: ${firstVal}`);
            for (let i = 1; i < entries.length; i++) {
              const [k, v] = entries[i];
              lines.push(`    ${k}: ${v}`);
            }
          }
        } else {
          lines.push(`  - ${item}`);
        }
      }
    } else {
      lines.push(`${key}: ${String(val)}`);
    }
  }

  return lines;
}

export async function GET(): Promise<Response> {
  const entries = getExperience();

  // Sort: current first, then by startDate descending
  entries.sort((a, b) => {
    const aCurrent = a.endDate === null;
    const bCurrent = b.endDate === null;

    if (aCurrent && !bCurrent) return -1;
    if (!aCurrent && bCurrent) return 1;

    if (a.startDate !== null && b.startDate !== null) {
      const dateCmp = b.startDate.localeCompare(a.startDate);
      if (dateCmp !== 0) return dateCmp;
    }
    if (a.startDate === null) return 1;
    if (b.startDate === null) return -1;

    if (a.endDate !== null && b.endDate !== null) {
      return b.endDate.localeCompare(a.endDate);
    }
    return 0;
  });

  const lines: string[] = [
    '# woss.io',
    '',
    '> Personal site of a software engineer with expertise in distributed systems, blockchain, full-stack development, and DevOps.',
    '',
    'Content on this site covers professional experience across multiple companies and roles — from startups to enterprise — with detailed descriptions of projects and skills.',
    '',
  ];

  for (const e of entries) {
    const meta = {
      company: e.company,
      role: e.role,
      startDate: e.startDate,
      endDate: e.endDate,
      duration: e.duration,
      skills: e.skills,
      description: e.description,
    };

    lines.push(`# ${e.company} — ${e.role}`);
    lines.push('');
    lines.push('---');
    lines.push(...formatMeta(meta));
    lines.push('---');
    lines.push('');
    lines.push(e.content.trim());
    lines.push('');
    lines.push('---------');
  }

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
