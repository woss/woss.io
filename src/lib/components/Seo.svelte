<script lang="ts">
 let {
 title = 'woss.io',
 description = '',
 image,
 url,
 type = 'website',
 publishedTime,
 tags = [],
 }: {
 title?: string;
 description?: string;
 image?: { url: string; alt: string } | string | null;
 url?: string;
 type?: string;
 publishedTime?: string | null;
 tags?: string[];
 } = $props();

 const imgUrl = $derived(typeof image === 'string' ? image : image?.url ?? '');
 const imgAlt = $derived(typeof image === 'string' ? '' : image?.alt ?? '');
</script>

<svelte:head>
 <title>{title}</title>
 <meta name="description" content={description} />
 <meta property="og:title" content={title} />
 <meta property="og:description" content={description} />
 <meta property="og:type" content={type} />
 <meta name="twitter:card" content="summary_large_image" />
 <meta name="twitter:title" content={title} />
 <meta name="twitter:description" content={description} />
 {#if imgUrl}
 <meta property="og:image" content={imgUrl} />
 <meta name="twitter:image" content={imgUrl} />
 {#if imgAlt}
 <meta property="og:image:alt" content={imgAlt} />
 {/if}
 {/if}
 {#if url}
 <meta property="og:url" content={url} />
 {/if}
 {#if publishedTime}
 <meta property="article:published_time" content={publishedTime} />
 {/if}
  {#each tags as tag (tag)}
  <meta property="article:tag" content={tag} />
  {/each}
</svelte:head>
