<script lang="ts">
  import { app, type Theme } from '../lib/store.svelte';
  import { toDay } from '../lib/dates';
  import Icon from './Icon.svelte';

  let { open = $bindable(false), installPrompt }: { open: boolean; installPrompt: (() => void) | null } = $props();
  let dialog: HTMLDialogElement;
  let fileInput: HTMLInputElement;

  $effect(() => {
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportJson() {
    download(await app.exportJson(), `weekly-backup-${toDay(new Date())}.json`);
  }

  async function exportDb() {
    const bytes = await app.exportDatabaseFile();
    download(new Blob([bytes as BlobPart], { type: 'application/vnd.sqlite3' }), `weekly-${toDay(new Date())}.sqlite3`);
  }

  async function importJson(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const n = await app.importJson(await file.text());
      app.toast(n ? `Imported ${n} ${n === 1 ? 'task' : 'tasks'}.` : 'Backup imported. Nothing was newer than what you have.');
    } catch (err) {
      app.toast(`Couldn't import: ${(err as Error).message}`);
    }
    fileInput.value = '';
  }

  const themes: { value: Theme; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];
</script>

<dialog bind:this={dialog} class="settings" aria-labelledby="settings-h" onclose={() => (open = false)} onclick={(e) => e.target === dialog && (open = false)}>
  <div class="inner">
    <div class="top">
      <h2 id="settings-h">Settings</h2>
      <button class="icon-btn" aria-label="Close" onclick={() => (open = false)}><Icon name="close" /></button>
    </div>

    <fieldset>
      <legend>Theme</legend>
      <div class="seg">
        {#each themes as t (t.value)}
          <label class:on={app.settings.theme === t.value}>
            <input type="radio" name="theme" value={t.value} checked={app.settings.theme === t.value} onchange={() => app.setSetting('theme', t.value)} />
            {t.label}
          </label>
        {/each}
      </div>
    </fieldset>

    <label class="switch">
      <input
        id="opt-anytime"
        type="checkbox"
        checked={app.settings.unscheduledOnToday}
        onchange={(e) => app.setSetting('unscheduledOnToday', e.currentTarget.checked)}
      />
      <span>
        <strong>Show tasks without a date on today</strong>
        <small>They appear at the bottom of today's column with a dashed outline.</small>
      </span>
    </label>

    <section>
      <h3>Backup</h3>
      <p class="muted">
        {app.persistent ? 'Your tasks are stored in this browser only.' : 'This browser is not keeping your tasks.'}
        A backup file restores them here or on another device. Importing keeps whichever copy of a task was edited last.
      </p>
      <div class="row">
        <button class="btn" onclick={exportJson}>Export backup</button>
        <button class="btn" onclick={() => fileInput.click()}>Import backup</button>
        <button class="btn" onclick={exportDb}>Download SQLite file</button>
        <input bind:this={fileInput} type="file" accept="application/json,.json" hidden onchange={importJson} />
      </div>
    </section>

    {#if installPrompt}
      <section>
        <h3>Install</h3>
        <p class="muted">Add Weekly to your home screen or dock. It works offline.</p>
        <button class="btn primary" onclick={installPrompt}>Install app</button>
      </section>
    {/if}

    <section>
      <h3>Keyboard</h3>
      <dl class="keys">
        <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Previous / next week</dd>
        <dt><kbd>T</kbd></dt><dd>Go to this week</dd>
        <dt><kbd>N</kbd></dt><dd>New task today</dd>
        <dt><kbd>Esc</kbd></dt><dd>Close</dd>
      </dl>
    </section>

    <p class="muted small">Device ID {app.settings.deviceId.slice(0, 8)} · sync between devices is planned</p>
  </div>
</dialog>

<style>
  .settings {
    width: min(480px, calc(100vw - 32px));
    max-height: calc(100dvh - 48px);
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--card);
    color: var(--ink);
    box-shadow: var(--shadow-lift);
  }
  .settings::backdrop {
    background: var(--scrim);
  }
  .inner {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 16px 20px 20px;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-right: -8px;
  }
  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 650;
  }
  h3 {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-2);
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 6px;
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-2);
  }
  .seg {
    display: inline-flex;
    padding: 3px;
    border-radius: var(--r-md);
    background: var(--bg);
  }
  .seg label {
    padding: 6px 14px;
    border-radius: 7px;
    font-weight: 550;
    cursor: pointer;
  }
  .seg label.on {
    background: var(--card);
    box-shadow: var(--shadow);
  }
  .seg input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .seg label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
  }
  .switch {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    cursor: pointer;
  }
  .switch input {
    width: 18px;
    height: 18px;
    margin: 2px 0 0;
    accent-color: var(--accent);
  }
  .switch span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .switch small,
  .muted {
    color: var(--ink-2);
    font-size: 13px;
  }
  .muted {
    margin: 0 0 10px;
    max-width: 52ch;
  }
  .small {
    margin: 0;
    font-size: 12px;
    color: var(--ink-3);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .keys {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 14px;
    margin: 0;
    font-size: 13px;
  }
  dd {
    margin: 0;
    color: var(--ink-2);
  }
  kbd {
    display: inline-block;
    min-width: 22px;
    padding: 1px 6px;
    border: 1px solid var(--line-strong);
    border-bottom-width: 2px;
    border-radius: 4px;
    font-family: inherit;
    font-size: 12px;
    text-align: center;
  }
</style>
