import { getChat, getMessages, getToolCallsForMessages } from '$lib/server/db';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.chat);

export const GET: RequestHandler = async ({ params, url }) => {
  const { id } = params;
  if (!id) throw error(400, 'Chat ID is required');
  const format = url.searchParams.get('format') ?? 'json';

  if (format !== 'md' && format !== 'json') {
    throw error(400, 'Invalid format. Use ?format=md or ?format=json');
  }

  const chat = getChat(id);
  if (!chat) throw error(404, 'Chat not found');

  const storedMessages = getMessages(id, 500, 0);
  const messageIds = storedMessages.map((m) => m.id);
  const toolCallsByMessage = getToolCallsForMessages(messageIds);

  const messages = storedMessages.map((m) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsedSources: any;
    try {
      parsedSources = m.sources ? JSON.parse(m.sources) : undefined;
    } catch (e) {
      log.warn`Failed to parse sources JSON for message ${m.id}: ${e}`;
      parsedSources = undefined;
    }

    return {
      id: m.id,
      role: m.role === 'system' ? 'assistant' : m.role,
      text: m.content || '',
      sources: parsedSources,
      timestamp: new Date(m.createdAt).getTime() || Date.now(),
      createdAt: m.createdAt,
      tokensIn: m.tokensIn || 0,
      tokensOut: m.tokensOut || 0,
      durationMs: m.durationMs || 0,
      error: m.error || undefined,
      irrecoverable: m.irrecoverable || undefined,
      deletedAt: m.deletedAt || undefined,
      queryType: m.queryType || undefined,
      toolCalls: toolCallsByMessage[m.id] || [],
    };
  });

  if (format === 'json') {
    const body = JSON.stringify(
      {
        chat: {
          id: chat.id,
          title: chat.title,
          createdAt: chat.createdAt,
          messageCount: chat.messageCount,
        },
        exportedAt: new Date().toISOString(),
        messages,
      },
      null,
      2,
    );

    return new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="woss.io-chat-${slugify(chat.title)}-${dateStr()}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // Markdown format
  const lines: string[] = [];
  lines.push(`# Chat: ${chat.title}`);
  lines.push('');
  lines.push(`*Exported from woss.io on ${new Date().toISOString()}*`);
  lines.push('');
  lines.push(`*${messages.length} messages*`);
  lines.push('');
  lines.push('---');
  lines.push('');

  messages.forEach((m, i) => {
    const roleLabel = m.role === 'user' ? 'User' : 'Assistant';
    lines.push(`## ${i + 1}. ${roleLabel} — ${m.createdAt}`);
    lines.push('');

    if (m.text) {
      lines.push(m.text);
      lines.push('');
    }

    if (m.sources && Array.isArray(m.sources) && m.sources.length > 0) {
      lines.push('**Sources:**');
      (m.sources as Array<{ title?: string; url?: string; score?: number }>).forEach((s) => {
        const title = s.title || 'Source';
        const url = s.url || '';
        const score = s.score != null ? ` — score: ${s.score.toFixed(2)}` : '';
        lines.push(`- [${title}](${url})${score}`);
      });
      lines.push('');
    }

    if (m.toolCalls && m.toolCalls.length > 0) {
      lines.push('**Tool Calls:**');
      m.toolCalls.forEach((tc) => {
        const dur = tc.durationMs != null ? ` — ${tc.durationMs}ms` : '';
        lines.push(`- **${tc.name}** on \`${tc.serverId}\`${dur}`);
      });
      lines.push('');
    }

    const metaParts: string[] = [];
    if (m.queryType) metaParts.push(`Type: ${m.queryType}`);
    if (m.tokensIn != null) metaParts.push(`Tokens: ${m.tokensIn}→${m.tokensOut}`);
    if (m.durationMs != null) metaParts.push(`Duration: ${m.durationMs}ms`);

    if (metaParts.length > 0) {
      lines.push(`*${metaParts.join(' | ')}*`);
      lines.push('');
    }

    if (i < messages.length - 1) {
      lines.push('---');
      lines.push('');
    }
  });

  lines.push('---');
  lines.push('');
  lines.push(`*End of chat. ${messages.length} messages total.*`);

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/markdown',
      'Content-Disposition': `attachment; filename="woss.io-chat-${slugify(chat.title)}-${dateStr()}.md"`,
      'Cache-Control': 'no-store',
    },
  });
};

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'chat'
  );
}

function dateStr(): string {
  return new Date().toISOString().split('T')[0];
}
