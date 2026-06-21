import { get } from 'svelte/store';
import { soundEnabled } from '$lib/stores/sounds';

let ctx: AudioContext | null = null;

export function playPluckSound(force = false) {
  if (typeof window === 'undefined') return;
  if (!force && !get(soundEnabled)) return;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(432, now);
  osc.frequency.exponentialRampToValueAtTime(864, now + 0.1);

  gain.gain.setValueAtTime(0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.78);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.5);
}
