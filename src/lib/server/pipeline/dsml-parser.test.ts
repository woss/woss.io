import { describe, it, expect } from 'vitest';
import { hasDsmlBlocks, stripDsmlBlocks } from './dsml-parser.ts';

const BAR = '｜DSML｜';

describe('hasDsmlBlocks', () => {
  it('detects the canonical form', () => {
    expect(hasDsmlBlocks(`<${BAR}tool_calls>...</${BAR}tool_calls>`)).toBe(true);
  });

  it('detects mangled dialect variants', () => {
    expect(hasDsmlBlocks(`<${BAR} calls>`)).toBe(true);
    expect(hasDsmlBlocks(`<${BAR} name="traverse">`)).toBe(true);
  });

  it('ignores plain text', () => {
    expect(hasDsmlBlocks('No markup here.')).toBe(false);
  });
});

describe('stripDsmlBlocks', () => {
  it('removes canonical DSML tool call blocks', () => {
    const text = [
      'Preamble.',
      `<${BAR}tool_calls>`,
      `<${BAR}invoke name="traverse">`,
      `<${BAR}parameter name="limit" string="false">5</${BAR}parameter>`,
      `</${BAR}invoke>`,
      `</${BAR}tool_calls>`,
    ].join('\n');
    expect(stripDsmlBlocks(text)).toBe('Preamble.');
  });

  it('strips the mangled variant observed in production', () => {
    const text = [
      'Let me check the gallery.',
      '',
      `<${BAR} calls>`,
      `<${BAR} invoke name="traverse">`,
      `<${BAR} parameter name="from">{"type": "root"}</${BAR} parameter>`,
      `<${BAR} parameter name="edge" string="true">recent</${BAR} parameter>`,
      `</${BAR} invoke>`,
      `</${BAR} calls>`,
    ].join('\n');
    expect(stripDsmlBlocks(text)).toBe('Let me check the gallery.');
  });

  it('strips mangled tags with missing element names', () => {
    const text = `Answer.\n\n<${BAR} calls>\n<${BAR} name="traverse">\n<${BAR} name="get_file">\n<${BAR} string="true">abc123</${BAR}>\n</${BAR}>\n</${BAR} calls>`;
    expect(stripDsmlBlocks(text)).toBe('Answer.');
  });

  it('cuts at the first tag even when prose follows a closed block', () => {
    const text = `Before\n<${BAR} calls>junk</${BAR} calls>\nAfter`;
    expect(stripDsmlBlocks(text)).toBe('Before');
  });

  it('strips an unterminated tag to the end of the text', () => {
    expect(stripDsmlBlocks(`Answer\n\n<${BAR} invoke name="traverse"`)).toBe('Answer');
  });

  it('returns plain text unchanged apart from trimming', () => {
    expect(stripDsmlBlocks('  Hello world  ')).toBe('Hello world');
  });
});
