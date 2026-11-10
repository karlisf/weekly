<script lang="ts">
  import { useRegisterSW } from 'virtual:pwa-register/svelte';
  import { app } from './lib/store.svelte';
  import { drag } from './lib/dnd.svelte';
  import { layout } from './lib/layout.svelte';
  import { isoWeek, startOfWeek, weekRangeLabel } from './lib/dates';
  import { delayedTasks, unscheduledTasks } from './lib/plan';
  import WeekGrid from './components/WeekGrid.svelte';
  import Agenda from './components/Agenda.svelte';
  import Backlog from './components/Backlog.svelte';
  import TaskDialog from './components/TaskDialog.svelte';
  import SettingsDialog from './components/SettingsDialog.svelte';
  import SyncDialog from './components/SyncDialog.svelte';
  import Toasts from './components/Toasts.svelte';
  import Icon from './components/Icon.svelte';

  let backlogOpen = $state(false);
  let settingsOpen = $state(false);
  let syncOpen = $state(false);
  const sync = app.sync;
  const syncLabel = $derived(
    !sync.space
      ? 'Sync'
      : sync.status === 'offline'
        ? 'Offline'
        : sync.status === 'connecting' || sync.pending
          ? 'Syncing'
          : 'Synced',
  );
  let installEvent = $state<(Event & { prompt: () => Promise<void> }) | null>(null);

  const isCurrentWeek = $derived(app.weekStart === startOfWeek(app.today));
  const delayedCount = $derived(delayedTasks(app.tasks, app.today).length);
  const undatedCount = $derived(unscheduledTasks(app.tasks).length);

  drag.onDrop = (p, target) => void app.moveTask(p.taskId, p.fromDay, target);
  // Get the sheet out of the way so the week is visible as a drop target.
  drag.onStart = () => {
    if (!layout.wide) backlogOpen = false;
  };

  // autoUpdate: a new service worker takes over and the page reloads itself.
  useRegisterSW({
    immediate: true,
    onRegisterError: (e) => console.warn('Service worker registration failed', e),
  });

  $effect(() => {
    const root = document.documentElement;
    if (app.settings.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = app.settings.theme;
  });

  function onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
    if (app.status.kind !== 'ready') return;
    if (e.key === 'ArrowLeft') app.goWeek(-1);
    else if (e.key === 'ArrowRight') app.goWeek(1);
    else if (e.key === 't' || e.key === 'T') app.goToday();
    else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      app.goToday();
      app.quickAddDay = app.today;
    } else return;
  }
</script>

<svelte:window
  onkeydown={onKey}
  onbeforeinstallprompt={(e) => {
    e.preventDefault();
    installEvent = e as unknown as typeof installEvent;
  }}
/>

<div class="app" class:mobile={layout.mobile} class:wide={layout.wide}>
  <header class="topbar">
    <div class="brand" aria-label="Weekly">
      <img src="./favicon.svg" alt="" width="26" height="26" />
      <span class="wordmark">Weekly</span>
    </div>

    <div class="week">
      <button class="icon-btn" aria-label="Previous week" onclick={() => app.goWeek(-1)}><Icon name="left" /></button>
      <h1 class="week-label">
        <span class="wk">Week {isoWeek(app.weekStart)}</span>
        <span class="range">{weekRangeLabel(app.weekStart)}</span>
      </h1>
      <button class="icon-btn" aria-label="Next week" onclick={() => app.goWeek(1)}><Icon name="right" /></button>
      {#if !isCurrentWeek}
        <button class="btn today-btn" onclick={() => app.goToday()}>Today</button>
      {/if}
    </div>

    <div class="actions">
      {#if !layout.wide && !layout.mobile}
        <button class="btn" aria-expanded={backlogOpen} onclick={() => (backlogOpen = !backlogOpen)}>
          <Icon name="inbox" />Backlog
          {#if delayedCount}<span class="badge late">{delayedCount}</span>{/if}
        </button>
      {/if}
      <button
        class="sync-btn"
        data-state={sync.space ? sync.status : 'none'}
        aria-label="Sync: {syncLabel}{sync.pending ? `, ${sync.pending} waiting` : ''}"
        onclick={() => (syncOpen = true)}
      >
        <Icon name={sync.status === 'offline' ? 'cloudOff' : 'cloud'} />
        <span class="sync-label">{syncLabel}</span>
        {#if sync.space}<span class="sync-dot" aria-hidden="true"></span>{/if}
      </button>
      <button class="icon-btn" aria-label="Settings" onclick={() => (settingsOpen = true)}><Icon name="more" /></button>
    </div>
  </header>

  {#if app.status.kind === 'ready'}
    <div class="main">
      {#if layout.wide}
        <aside class="side" aria-label="Backlog"><Backlog /></aside>
      {/if}
      <main class="week-area">
        {#if layout.mobile}<Agenda />{:else}<WeekGrid />{/if}
      </main>
    </div>

    {#if layout.mobile}
      <button class="fab" onclick={() => (backlogOpen = true)}>
        <Icon name="inbox" />
        <span>Backlog</span>
        {#if delayedCount}<span class="badge late">{delayedCount} late</span>{/if}
        {#if undatedCount}<span class="badge">{undatedCount} no date</span>{/if}
      </button>
    {/if}

    {#if !layout.wide && backlogOpen}
      <div class="scrim" role="presentation" onclick={() => (backlogOpen = false)}></div>
      <aside class="drawer" class:sheet={layout.mobile} aria-label="Backlog">
        <div class="drawer-head">
          <span>Backlog</span>
          <button class="icon-btn" aria-label="Close backlog" onclick={() => (backlogOpen = false)}><Icon name="close" /></button>
        </div>
        <Backlog />
      </aside>
    {/if}
  {:else}
    <div class="state">
      {#if app.status.kind === 'loading'}
        <p class="muted">Opening your planner…</p>
      {:else if app.status.kind === 'busy'}
        <h2>Weekly is open in another tab</h2>
        <p class="muted">Your tasks can be edited in one tab at a time.</p>
        <button class="btn primary" onclick={() => app.takeOver()}>Use it here</button>
      {:else if app.status.kind === 'released'}
        <h2>Weekly moved to another tab</h2>
        <p class="muted">You opened it somewhere else, so this tab stepped aside.</p>
        <button class="btn primary" onclick={() => app.takeOver()}>Use it here</button>
      {:else if app.status.kind === 'error'}
        <h2>Couldn't open your planner</h2>
        <p class="muted">{app.status.message}</p>
        <button class="btn primary" onclick={() => location.reload()}>Reload</button>
      {/if}
    </div>
  {/if}

  <TaskDialog />
  <SyncDialog bind:open={syncOpen} />
  <SettingsDialog bind:open={settingsOpen} installPrompt={installEvent ? () => installEvent?.prompt() : null} />
  <Toasts />
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding-top: env(safe-area-inset-top, 0px);
  }
  .app.mobile {
    height: auto;
    min-height: 100%;
  }

  .topbar {
    position: sticky;
    top: env(safe-area-inset-top, 0px);
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 12px;
    height: var(--topbar-h);
    flex: none;
    padding: 0 max(16px, env(safe-area-inset-right, 0px)) 0 max(16px, env(safe-area-inset-left, 0px));
    background: var(--bg);
    border-bottom: 1px solid var(--line);
  }
  .mobile .topbar::before {
    content: '';
    position: fixed;
    inset: 0 0 auto;
    height: env(safe-area-inset-top, 0px);
    background: var(--bg);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 280px;
    flex: none;
  }
  .wordmark {
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .week {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .week-label {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 0 6px;
    min-width: 0;
    font-size: inherit;
    font-weight: inherit;
    white-space: nowrap;
  }
  .wk {
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 650;
    letter-spacing: -0.01em;
    font-variant-numeric: tabular-nums;
  }
  .range {
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }
  .today-btn {
    height: 30px;
    margin-left: 6px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }
  .sync-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--ink-2);
    font-weight: 550;
  }
  .sync-btn:hover {
    background: var(--accent-soft);
    color: var(--ink);
  }
  .sync-dot {
    position: absolute;
    left: 22px;
    top: 9px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1.5px solid var(--bg);
    background: var(--ink-3);
  }
  .sync-btn[data-state='online'] .sync-dot {
    background: var(--done);
  }
  .sync-btn[data-state='connecting'] .sync-dot {
    background: var(--hl);
  }
  .sync-btn[data-state='offline'] .sync-dot {
    background: var(--late);
  }
  .badge {
    padding: 1px 7px;
    border-radius: 10px;
    background: var(--line);
    color: var(--ink-2);
    font-size: 11.5px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .badge.late {
    background: var(--late-soft);
    color: var(--late);
  }

  .main {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .side {
    flex: none;
    width: 296px;
    border-right: 1px solid var(--line);
    background: var(--bg);
  }
  .week-area {
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: var(--scrim);
  }
  .drawer {
    position: fixed;
    z-index: 41;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    width: min(360px, 92vw);
    padding-top: env(safe-area-inset-top, 0px);
    padding-right: env(safe-area-inset-right, 0px);
    background: var(--bg);
    box-shadow: var(--shadow-lift);
    animation: slide-in 0.18s ease-out;
  }
  .drawer :global(.backlog) {
    flex: 1;
    min-height: 0;
  }
  .drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--topbar-h);
    padding: 0 8px 0 16px;
    border-bottom: 1px solid var(--line);
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 650;
  }
  .drawer.sheet {
    top: auto;
    left: 0;
    width: 100%;
    max-height: 82dvh;
    padding: 0 env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
    border-radius: var(--r-lg) var(--r-lg) 0 0;
    animation-name: sheet-up;
  }
  @keyframes slide-in {
    from {
      transform: translateX(24px);
      opacity: 0;
    }
  }
  @keyframes sheet-up {
    from {
      transform: translateY(40px);
      opacity: 0;
    }
  }

  .fab {
    position: fixed;
    z-index: 20;
    left: 50%;
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 46px;
    padding: 0 16px;
    border: 1px solid var(--line-strong);
    border-radius: 23px;
    background: var(--card);
    box-shadow: var(--shadow-lift);
    font-weight: 600;
    white-space: nowrap;
  }

  .state {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 32px 16px;
    text-align: center;
  }
  .state h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 22px;
    text-wrap: balance;
  }
  .muted {
    margin: 0;
    color: var(--ink-2);
    max-width: 46ch;
  }

  /* Tablet: no docked panel, brand shrinks. */
  @media (max-width: 1179px) {
    .brand {
      width: auto;
    }
  }
  /* Phone: compact bar, the wordmark gives way to the week. */
  @media (max-width: 719px) {
    .topbar {
      gap: 4px;
      padding-left: max(8px, env(safe-area-inset-left, 0px));
      padding-right: max(8px, env(safe-area-inset-right, 0px));
    }
    .wordmark {
      display: none;
    }
    .brand {
      padding-left: 6px;
    }
    .week {
      flex: 1;
      justify-content: center;
    }
    .week-label {
      flex-direction: column;
      align-items: center;
      gap: 0;
      margin: 0 2px;
      line-height: 1.15;
    }
    .wk {
      font-size: 16px;
    }
    .range {
      font-size: 12px;
    }
    .today-btn {
      position: absolute;
      right: max(52px, calc(env(safe-area-inset-right, 0px) + 44px));
      height: 28px;
      padding: 0 8px;
      font-size: 13px;
    }
    .actions {
      margin-left: 0;
      gap: 0;
    }
    .sync-label {
      display: none;
    }
    .sync-btn {
      padding: 0 9px;
    }
  }
</style>
