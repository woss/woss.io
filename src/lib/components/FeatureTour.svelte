<script lang="ts">
  import { tick } from 'svelte';

  let {
    targetSelector,
    title,
    content,
    ondismiss,
  }: {
    targetSelector: string;
    title: string;
    content: string;
    ondismiss: () => void;
  } = $props();

  let cardEl: HTMLDivElement | undefined = $state();
  let style = $state('');
  let arrowStyle = $state('');
  function position(): void {
    const target = document.querySelector(targetSelector);
    if (!target || !cardEl) return;

    const targetRect = target.getBoundingClientRect();
    const cardRect = cardEl.getBoundingClientRect();
    const gap = 12;

    // Determine placement: prefer top, fall back to bottom if viewport space is tight
    const spaceAbove = targetRect.top;
    const spaceBelow = window.innerHeight - targetRect.bottom;
    const useTop = spaceAbove >= cardRect.height + gap + 24 || spaceAbove >= spaceBelow;

    const arrowSize = 8;
    const cardTop = useTop
      ? targetRect.top - cardRect.height - gap - arrowSize
      : targetRect.bottom + gap + arrowSize;

    // Center card horizontally on the target
    let cardLeft = targetRect.left + targetRect.width / 2 - cardRect.width / 2;

    // Clamp to viewport edges with padding
    const padding = 16;
    cardLeft = Math.max(padding, Math.min(cardLeft, window.innerWidth - cardRect.width - padding));

    style = `position:fixed;top:${cardTop}px;left:${cardLeft}px;z-index:999`;

    // Arrow points at target center
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const arrowLeft = targetCenterX - cardLeft - arrowSize;

    if (useTop) {
      // Arrow at bottom of card, pointing down
      arrowStyle = `position:absolute;bottom:-${arrowSize * 2}px;left:${arrowLeft}px;width:0;height:0;border-left:${arrowSize}px solid transparent;border-right:${arrowSize}px solid transparent;border-top:${arrowSize * 2}px solid var(--color-surface-container-high, #2a2a2a)`;
    } else {
      // Arrow at top of card, pointing up
      arrowStyle = `position:absolute;top:-${arrowSize * 2}px;left:${arrowLeft}px;width:0;height:0;border-left:${arrowSize}px solid transparent;border-right:${arrowSize}px solid transparent;border-bottom:${arrowSize * 2}px solid var(--color-surface-container-high, #2a2a2a)`;
    }
  }

  $effect(() => {
    // Position after mount
    tick().then(position);

    // Re-observe on resize
    const ro = new ResizeObserver(position);
    const target = document.querySelector(targetSelector);
    if (target) ro.observe(target);
    window.addEventListener('resize', position);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', position);
      if (target) ro.unobserve(target);
    };
  });
</script>

<div bind:this={cardEl} class="tour-card" {style} role="dialog" aria-label={title}>
  <div class="tour-arrow" style={arrowStyle}></div>
  <div class="tour-content">
    <h3 class="tour-title">{title}</h3>
    <p class="tour-body">{content}</p>
    <div class="tour-actions">
      <button class="tour-btn-primary" onclick={() => ondismiss()}>Got it</button>
      <button class="tour-btn-ghost" onclick={() => ondismiss()}>Skip</button>
    </div>
  </div>
</div>

<style>
  .tour-card {
    background: var(--color-surface-container-high, #2a2a2a);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    max-width: 320px;
    pointer-events: auto;
    animation: tour-in 0.25s ease-out;
  }

  @keyframes tour-in {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .tour-content {
    padding: 16px;
  }

  .tour-title {
    margin: 0 0 8px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-on-surface, #e0e0e0);
    line-height: 1.3;
  }

  .tour-body {
    margin: 0 0 16px 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--color-on-surface-variant, #a0a0a0);
  }

  .tour-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .tour-btn-primary {
    padding: 6px 16px;
    border: none;
    border-radius: 8px;
    background: var(--color-primary, #3b82f6);
    color: white;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .tour-btn-primary:hover {
    opacity: 0.85;
  }

  .tour-btn-ghost {
    padding: 6px 16px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    background: transparent;
    color: var(--color-on-surface-variant, #a0a0a0);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }
  .tour-btn-ghost:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--color-on-surface, #e0e0e0);
  }
</style>
