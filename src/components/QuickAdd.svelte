<script lang="ts">
  import { app } from '../lib/store.svelte';
  import type { Day } from '../lib/dates';

  let { day, onclose, placeholder = 'New task' }: { day: Day | null; onclose: () => void; placeholder?: string } =
    $props();

  let value = $state('');
  let input: HTMLInputElement;

  $effect(() => {
    input.focus();
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!value.trim()) return onclose();
    await app.addTask(value, day);
    value = '';
  }
</script>

<form class="quick" onsubmit={submit}>
  <input
    bind:this={input}
    bind:value
    {placeholder}
    aria-label="Task title"
    enterkeyhint="done"
    onkeydown={(e) => e.key === 'Escape' && onclose()}
    onblur={() => !value.trim() && onclose()}
  />
</form>

<style>
  .quick input {
    width: 100%;
    height: 38px;
    padding: 0 10px;
    border: 1.5px solid var(--accent);
    border-radius: var(--r-md);
    background: var(--card);
    outline: none;
    font-size: 16px; /* 16px keeps iOS from zooming on focus */
  }
  @media (min-width: 720px) {
    .quick input {
      font-size: 14px;
    }
  }
</style>
