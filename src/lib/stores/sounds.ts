import { writable } from 'svelte/store';
import { browser } from '$app/environment';

function createSoundStore() {
  const stored = browser ? localStorage.getItem('woss-sound-enabled') : null;
  const initial = stored !== null ? stored === 'true' : true;
  const { subscribe, set, update } = writable<boolean>(initial);

  return {
    subscribe,
    toggle: () =>
      update((v) => {
        const next = !v;
        if (browser) localStorage.setItem('woss-sound-enabled', String(next));
        return next;
      }),
    enable: () => {
      set(true);
      if (browser) localStorage.setItem('woss-sound-enabled', 'true');
    },
    disable: () => {
      set(false);
      if (browser) localStorage.setItem('woss-sound-enabled', 'false');
    },
  };
}

export const soundEnabled = createSoundStore();
