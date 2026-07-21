/**
 * Adversarial tests for Svelte 5 $state() rune fix on bind:this variables.
 *
 * Change: `let createFormEl: HTMLFormElement;` → `let createFormEl = $state<HTMLFormElement>();`
 * Files: src/routes/+page.svelte, src/routes/chat/+page.svelte
 *
 * These tests perform static analysis on the source files to verify:
 * 1. $state() is used for all bind:this element references
 * 2. Type parameters are correct
 * 3. requestSubmit() calls are unguarded against undefined (potential runtime crash)
 * 4. Both files use consistent patterns
 * 5. The bind:this template targets match the declared variables
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '../..');

function readFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf-8');
}

const PAGE_SVELTE = readFile('src/routes/+page.svelte');
const CHAT_PAGE_SVELTE = readFile('src/routes/chat/+page.svelte');

function extractScriptBlock(source: string): string {
  const match = source.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  return match?.[1] ?? '';
}

describe('Svelte 5 $state() rune for bind:this variables', () => {
  describe('src/routes/+page.svelte', () => {
    const script = extractScriptBlock(PAGE_SVELTE);

    test('createFormEl uses $state() rune, not plain let', () => {
      const plainDecl = script.match(/\blet\s+createFormEl\s*:\s*HTMLFormElement\s*;/);
      expect(plainDecl).toBeNull();

      const stateDecl = script.match(/\blet\s+createFormEl\s*=\s*\$state\s*<\s*HTMLFormElement\s*>\s*\(\s*\)\s*;/);
      expect(stateDecl).not.toBeNull();
    });

    test('deleteFormEl uses $state() rune, not plain let', () => {
      const plainDecl = script.match(/\blet\s+deleteFormEl\s*:\s*HTMLFormElement\s*;/);
      expect(plainDecl).toBeNull();

      const stateDecl = script.match(/\blet\s+deleteFormEl\s*=\s*\$state\s*<\s*HTMLFormElement\s*>\s*\(\s*\)\s*;/);
      expect(stateDecl).not.toBeNull();
    });

    test('createFormEl has bind:this in template', () => {
      const bindMatch = PAGE_SVELTE.match(/bind:this\s*=\s*\{createFormEl\}/);
      expect(bindMatch).not.toBeNull();
    });

    test('deleteFormEl has bind:this in template', () => {
      const bindMatch = PAGE_SVELTE.match(/bind:this\s*=\s*\{deleteFormEl\}/);
      expect(bindMatch).not.toBeNull();
    });

    test('requestSubmit() is called on createFormEl (used after mount)', () => {
      const calls = [...script.matchAll(/\bcreateFormEl\s*\.\s*requestSubmit\s*\(\s*\)/g)];
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    test('requestSubmit() is called on deleteFormEl', () => {
      const calls = [...script.matchAll(/\bdeleteFormEl\s*\.\s*requestSubmit\s*\(\s*\)/g)];
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    test('forms are inside {#if ready} guard (prevents premature access)', () => {
      const readyGuard = PAGE_SVELTE.match(/\{#if\s+ready\}/);
      expect(readyGuard).not.toBeNull();
    });
  });

  describe('src/routes/chat/+page.svelte', () => {
    const script = extractScriptBlock(CHAT_PAGE_SVELTE);

    test('createFormEl uses $state() rune, not plain let', () => {
      const plainDecl = script.match(/\blet\s+createFormEl\s*:\s*HTMLFormElement\s*;/);
      expect(plainDecl).toBeNull();

      const stateDecl = script.match(/\blet\s+createFormEl\s*=\s*\$state\s*<\s*HTMLFormElement\s*>\s*\(\s*\)\s*;/);
      expect(stateDecl).not.toBeNull();
    });

    test('deleteFormEl uses $state() rune, not plain let', () => {
      const plainDecl = script.match(/\blet\s+deleteFormEl\s*:\s*HTMLFormElement\s*;/);
      expect(plainDecl).toBeNull();

      const stateDecl = script.match(/\blet\s+deleteFormEl\s*=\s*\$state\s*<\s*HTMLFormElement\s*>\s*\(\s*\)\s*;/);
      expect(stateDecl).not.toBeNull();
    });

    test('createFormEl has bind:this in template', () => {
      const bindMatch = CHAT_PAGE_SVELTE.match(/bind:this\s*=\s*\{createFormEl\}/);
      expect(bindMatch).not.toBeNull();
    });

    test('deleteFormEl has bind:this in template', () => {
      const bindMatch = CHAT_PAGE_SVELTE.match(/bind:this\s*=\s*\{deleteFormEl\}/);
      expect(bindMatch).not.toBeNull();
    });

    test('requestSubmit() is called on createFormEl', () => {
      const calls = [...script.matchAll(/\bcreateFormEl\s*\.\s*requestSubmit\s*\(\s*\)/g)];
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    test('requestSubmit() is called on deleteFormEl', () => {
      const calls = [...script.matchAll(/\bdeleteFormEl\s*\.\s*requestSubmit\s*\(\s*\)/g)];
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Cross-file consistency', () => {
    test('both files declare createFormEl and deleteFormEl with $state<HTMLFormElement>()', () => {
      const pageScript = extractScriptBlock(PAGE_SVELTE);
      const chatScript = extractScriptBlock(CHAT_PAGE_SVELTE);

      const pageCreate = pageScript.match(/\$state\s*<\s*HTMLFormElement\s*>\s*\(\s*\)/);
      const chatCreate = chatScript.match(/\$state\s*<\s*HTMLFormElement\s*>\s*\(\s*\)/);

      expect(pageCreate).not.toBeNull();
      expect(chatCreate).not.toBeNull();
    });

    test('no remaining plain let type annotations for bind:this elements', () => {
      const allSources = [
        { name: '+page.svelte', content: PAGE_SVELTE },
        { name: 'chat/+page.svelte', content: CHAT_PAGE_SVELTE },
      ];

      for (const { content } of allSources) {
        const script = extractScriptBlock(content);
        const plainDecl = script.match(/\blet\s+(createFormEl|deleteFormEl)\s*:\s*HTMLFormElement\s*;/);
        expect(plainDecl).toBeNull();
      }
    });
  });

  describe('Runtime safety — requestSubmit on possibly-undefined refs', () => {
    test('$state<HTMLFormElement>() produces HTMLFormElement | undefined type', () => {
      // BUG: $state<HTMLFormElement>() with no initial value has type
      // HTMLFormElement | undefined. All .requestSubmit() calls are unguarded
      // and would be TypeScript errors with strict mode.
      //
      // With the OLD code (`let x: HTMLFormElement;`), Svelte 4's implicit
      // reactivity meant the variable was typed as HTMLFormElement (no undefined).
      //
      // With $state<HTMLFormElement>(), the runtime value IS undefined until
      // mount, and the TYPE includes undefined. The fix should be either:
      //   a) $state<HTMLFormElement | undefined>(undefined) + null guards, or
      //   b) Keep the type as-is but the code MUST use optional chaining:
      //      createFormEl?.requestSubmit()

      // Verify the declaration has no initial value (defaults to undefined)
      const allSources = [
        { name: '+page.svelte', content: PAGE_SVELTE },
        { name: 'chat/+page.svelte', content: CHAT_PAGE_SVELTE },
      ];

      for (const { name, content } of allSources) {
        const script = extractScriptBlock(content);
        const noArgDecl = script.match(/\$state\s*<\s*HTMLFormElement\s*>\s*\(\s*\)/);
        expect(noArgDecl).not.toBeNull();
      }
    });

    test('requestSubmit() calls lack null guards — TS strict mode will fail', () => {
      // Count all unguarded requestSubmit calls across both files
      const allContent = PAGE_SVELTE + '\n' + CHAT_PAGE_SVELTE;

      // Find all requestSubmit calls NOT preceded by ?. (optional chaining)
      const allSubmitCalls = [...allContent.matchAll(/\b(createFormEl|deleteFormEl)\s*(?!\?)\s*\.\s*requestSubmit/g)];

      // Every single call should have a null guard — none do currently
      // This documents the type safety gap
      const unguardedCalls = allSubmitCalls.filter((m) => !m[0].includes('?.'));

      // This test DOCUMENTS the finding: there are unguarded calls.
      // We expect > 0 unguarded calls to confirm the bug exists.
      expect(unguardedCalls.length).toBeGreaterThan(0);
    });
  });
});
