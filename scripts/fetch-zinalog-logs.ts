#!/usr/bin/env tsx
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

const BASE_URL = process.env.ZINALOG_URL ?? 'https://logs.woss.io';

interface LogEntry {
  id: number;
  created_at: string;
  level: string;
  message: string;
  service: string | null;
  stack: string | null;
  metadata: string | null;
  api_key_id: number | null;
  [key: string]: unknown;
}

interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function question(query: string, silent = false): Promise<string> {
  if (!silent) {
    const rl = createInterface({ input: stdin, output: stdout });
    return new Promise((resolve) => {
      rl.question(query, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  return promptSilent(query);
}

function promptSilent(query: string): Promise<string> {
  stdout.write(query);
  stdin.setRawMode?.(true);
  stdin.resume();

  return new Promise((resolve) => {
    let password = '';

    const onData = (data: Buffer): void => {
      const chars = data.toString();
      for (const char of chars) {
        if (char === '\n' || char === '\r') {
          stdin.removeListener('data', onData);
          stdin.setRawMode?.(false);
          stdin.pause();
          stdout.write('\n');
          resolve(password);
          return;
        }
        if (char === '\x7f' || char === '\b') {
          if (password.length > 0) {
            password = password.slice(0, -1);
            stdout.write('\b \b');
          }
          continue;
        }
        password += char;
        stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

function promptCredentials(): { username: string; password: string } {
  const envUser = process.env.ZINALOG_USER;
  const envPass = process.env.ZINALOG_PASS;

  if (envUser && envPass) {
    return { username: envUser, password: envPass };
  }

  return { username: envUser ?? '', password: envPass ?? '' };
}

async function authenticate(url: string, username: string, password: string): Promise<string> {
  const response = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new Error(`Authentication failed (${response.status} ${response.statusText})`);
  }

  const cookieHeader = response.headers.get('Set-Cookie');
  if (!cookieHeader) {
    throw new Error('Server returned no Set-Cookie header after login');
  }

  const sessionCookie = cookieHeader.split(';')[0];
  if (!sessionCookie.startsWith('zinalog_session=')) {
    throw new Error('Unexpected cookie format: expected zinalog_session cookie');
  }

  return sessionCookie;
}

async function fetchLogs(url: string, cookie: string): Promise<{ logs: LogEntry[]; pagination: Pagination }> {
  const response = await fetch(`${url}/api/logs?limit=200&from=30m`, {
    headers: { Cookie: cookie },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch logs (${response.status} ${response.statusText})`);
  }

  const body = (await response.json()) as { logs: unknown; pagination: unknown };

  if (!body.logs || !Array.isArray(body.logs)) {
    throw new Error('Unexpected response format: expected { logs: LogEntry[], pagination: {...} }');
  }

  return body as { logs: LogEntry[]; pagination: Pagination };
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) {
    return iso;
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

function printLogTable(logs: LogEntry[], pagination: Pagination): void {
  if (logs.length === 0) {
    console.log('No logs found.');
    return;
  }

  const maxServiceLen = logs.reduce((max, log) => Math.max(max, (log.service ?? '').length), 'service'.length);

  const tsPad = 19;
  const levelPad = 6;
  const servicePad = Math.min(maxServiceLen, 30);
  const msgMax = 100;
  const separator = '─'.repeat(tsPad + levelPad + servicePad + msgMax + 7);

  const headerTs = 'Timestamp'.padEnd(tsPad);
  const headerLevel = 'Level'.padEnd(levelPad);
  const headerService = 'Service'.padEnd(servicePad);
  const headerMsg = 'Message';

  console.log(`\n  ${headerTs}  ${headerLevel}  ${headerService}  ${headerMsg}`);
  console.log(`  ${separator}`);

  for (const log of logs) {
    const ts = formatTimestamp(log.created_at ?? log.timestamp).padEnd(tsPad);
    const level = (log.level ?? '').padEnd(levelPad);
    const service = (log.service ?? '').padEnd(servicePad);
    const msg = truncate(log.message ?? '', msgMax);
    console.log(`  ${ts}  ${level}  ${service}  ${msg}`);
  }

  console.log(
    `\n  Total: ${logs.length} log entries (page ${pagination.page} of ${pagination.totalPages}, ${pagination.total} total)\n`,
  );
}

async function main(): Promise<void> {
  const { username: envUser, password: envPass } = promptCredentials();

  const username = envUser || (await question('ZinaLog username: '));
  const password = envPass || (await question('ZinaLog password: ', true));

  if (!username || !password) {
    console.error('Error: Username and password are required.');
    process.exit(1);
  }

  try {
    const cookie = await authenticate(BASE_URL, username, password);
    const { logs, pagination } = await fetchLogs(BASE_URL, cookie);
    printLogTable(logs, pagination);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nError: ${message}`);
    process.exit(1);
  }
}

main();
