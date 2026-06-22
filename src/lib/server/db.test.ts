import { describe, it, expect } from 'vitest';
import { classifyDeviceType } from './db';

describe('classifyDeviceType', () => {
  it('classifies iPhone as mobile', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(classifyDeviceType(ua)).toBe('mobile');
  });

  it('classifies Android phone as mobile', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36';
    expect(classifyDeviceType(ua)).toBe('mobile');
  });

  it('classifies iPad as tablet', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(classifyDeviceType(ua)).toBe('tablet');
  });

  it('classifies Android tablet as tablet', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 13; SM-T870) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Safari/537.36';
    expect(classifyDeviceType(ua)).toBe('tablet');
  });

  it('classifies Kindle Fire as tablet', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 10; KFTRWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/86.3.1 like Chrome/86.0.4240.198 Safari/537.36';
    expect(classifyDeviceType(ua)).toBe('tablet');
  });

  it('classifies desktop Chrome as desktop', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    expect(classifyDeviceType(ua)).toBe('desktop');
  });

  it('classifies desktop Firefox as desktop', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0';
    expect(classifyDeviceType(ua)).toBe('desktop');
  });

  it('classifies Googlebot as bot', () => {
    const ua = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
    expect(classifyDeviceType(ua)).toBe('bot');
  });

  it('classifies GPTBot as bot', () => {
    const ua = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 GPTBot/1.0';
    expect(classifyDeviceType(ua)).toBe('bot');
  });

  it('classifies curl as bot', () => {
    const ua = 'curl/7.88.1';
    expect(classifyDeviceType(ua)).toBe('bot');
  });

  it('classifies Python urllib as bot', () => {
    const ua = 'Python-urllib/3.9';
    expect(classifyDeviceType(ua)).toBe('bot');
  });

  it('classifies Anthropic Claude crawler as bot', () => {
    const ua = 'Mozilla/5.0 (compatible; Claude; +https://claude.ai)';
    expect(classifyDeviceType(ua)).toBe('bot');
  });

  it('classifies empty string as desktop (fallback)', () => {
    expect(classifyDeviceType('')).toBe('desktop');
  });

  it('handles undefined-like input gracefully (empty string edge case)', () => {
    expect(classifyDeviceType('unknown')).toBe('bot');
  });

  it('classifies Android phone without Mobile keyword as mobile via Android check', () => {
    // Some Android browsers don't include "Mobile" but still have Android
    const ua =
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Safari/537.36';
    // This one DOES match Android in the mobile regex at the end
    expect(classifyDeviceType(ua)).toBe('mobile');
  });
});
