<script lang="ts">
  import { Switch } from 'sv5ui';
  import { get } from 'svelte/store';
  import { soundEnabled } from '$lib/stores/sounds';
  import { playPluckSound } from '$lib/utils/sounds';

  let soundOn = $state(get(soundEnabled));
  $effect(() => {
    const unsub = soundEnabled.subscribe(v => soundOn = v);
    return unsub;
  });

  function toggle() {
    const wasOff = !get(soundEnabled);
    soundEnabled.toggle();
    if (wasOff) playPluckSound(true);
  }
</script>

<Switch
  checked={soundOn}
  onCheckedChange={toggle}
  checkedIcon="lucide:volume-2"
  uncheckedIcon="lucide:volume-x"
  aria-label={soundOn ? 'Mute sounds' : 'Unmute sounds'}
/>
