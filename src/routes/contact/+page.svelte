<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getUserId } from '$lib/chat/constants';
  import ContactForm from '$lib/components/ContactForm.svelte';

  let userId = $state('');
  let showContactForm = $state(true);

  $effect(() => {
    if (!browser) return;
    const stored = getUserId();
    if (stored) {
      userId = stored;
    } else {
      userId = crypto.randomUUID();
    }
  });

  function handleDismiss() {
    goto(resolve('/')).catch(() => {});
  }
</script>

<svelte:head>
  <title>Contact · woss.io</title>
  <meta name="description" content="Get in touch with Daniel Maricic" />
</svelte:head>

<div class="max-w-2xl mx-auto px-4 py-16">
  <ContactForm bind:showContactForm {userId} ondismiss={handleDismiss} />
</div>
