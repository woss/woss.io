/**
 * One-time startup file integrity check.
 * Runs on first request in hooks.server.ts to verify all required runtime files exist.
 * Hard-fails (process.exit(1)) for critical files missing.
 * Soft-warns for non-critical files — app continues but may degrade.
 */
import { access, stat } from 'node:fs/promises';
import { constants, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.startup);

interface FileCheck {
  path: string;
  description: string;
  critical: boolean;
}

const CHECKS: FileCheck[] = [
  { path: 'data/centroid.json', description: 'Query classification centroids', critical: true },
  { path: 'data/centroid-hash.json', description: 'Centroid integrity hash', critical: false },
  { path: 'data/woss.db', description: 'SQLite database', critical: true },
  { path: 'data/woss.usearch', description: 'Vector search index', critical: true },
  { path: 'data/cache.usearch', description: 'LLM response cache index', critical: false },
  { path: 'data/.hf-cache', description: 'HuggingFace model cache directory', critical: false },
];

function logDataDirectory(): void {
  const cwd = process.cwd();
  const dataDir = join(cwd, 'data');
  log.info('=== DATA DIRECTORY CONTENTS ===');
  try {
    const entries = readdirSync(dataDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dataDir, entry.name);
      let size = 0;
      let type = '-';
      if (entry.isDirectory()) {
        type = 'd';
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        try {
          size = statSync(fullPath).size;
        } catch {
          /* ignore stat errors */
        }
      }
      log.info(`  ${type} ${String(size).padStart(10)} ${entry.name}`);
    }
  } catch (err) {
    log.error`[DIR] Failed to read data directory: ${err}`;
  }
}

export async function runStartupChecks(): Promise<void> {
  logDataDirectory();
  log.info('=== RUNTIME FILE INTEGRITY CHECK ===');

  const cwd = process.cwd();
  let allOk = true;

  for (const check of CHECKS) {
    const resolved = join(cwd, check.path);
    try {
      await access(resolved, constants.R_OK);
      const s = await stat(resolved);
      log.info(`[OK] ${check.description}: ${resolved} (size=${s.size}, mode=${s.mode.toString(8)})`);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      allOk = false;
      if (code === 'ENOENT') {
        log.error(`[MISSING] ${check.description}: NOT FOUND at ${resolved}`);
      } else {
        log.error(`[ACCESS] ${check.description}: NOT ACCESSIBLE at ${resolved} (code=${code})`);
      }
      if (check.critical) {
        log.error(`[FATAL] Missing critical file: ${check.description}. Exiting.`);
        process.exit(1);
      }
    }
  }

  if (allOk) {
    log.info('=== ALL RUNTIME FILES PRESENT ===');
    await warmupEmbeddings();
  } else {
    log.warn('=== SOME NON-CRITICAL FILES MISSING — APP MAY DEGRADE ===');
  }
}

async function warmupEmbeddings(): Promise<void> {
  log.info('=== PRE-LOADING EMBEDDING MODEL ===');
  try {
    const { embedText } = await import('$lib/server/embed');
    await embedText('warmup');
    log.info('=== EMBEDDING MODEL LOADED ===');
  } catch (err) {
    log.error`Embedding model warmup failed: ${err}`;
    log.warn('Embeddings will load lazily on first request');
  }
}
