<script lang="ts">
  import { app } from '../lib/store.svelte';
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each app.toasts as t (t.id)}
    <div class="toast">
      <span>{t.text}</span>
      {#if t.action}
        <button
          onclick={() => {
            t.action!.run();
            app.dismissToast(t.id);
          }}>{t.action.label}</button
        >
      {/if}
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: calc(20px + env(safe-area-inset-bottom, 0px));
    z-index: 900;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    width: min(440px, calc(100vw - 32px));
    transform: translateX(-50%);
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 14px;
    max-width: 100%;
    padding: 10px 10px 10px 16px;
    border-radius: var(--r-md);
    background: var(--ink);
    color: var(--bg);
    box-shadow: var(--shadow-lift);
    pointer-events: auto;
    animation: rise 0.18s ease-out;
  }
  .toast span {
    flex: 1;
    min-width: 0;
  }
  button {
    flex: none;
    height: 30px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--bg) 18%, transparent);
    color: var(--bg);
    font-weight: 650;
  }
  @keyframes rise {
    from {
      transform: translateY(8px);
      opacity: 0;
    }
  }
</style>
