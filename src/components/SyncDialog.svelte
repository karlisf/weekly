<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { CANDIDATE_RELAYS, DEFAULT_RELAYS, guessDeviceName, type Invite } from '../sync/engine.svelte';
  import { testRelay, usable, type RelayTestResult } from '../sync/relaytest';
  import { formatCode } from '../sync/crypto';
  import { isExampleTask } from '../lib/seed';
  import Icon from './Icon.svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();
  let dialog: HTMLDialogElement;
  const sync = app.sync;

  type View = 'home' | 'join' | 'invite' | 'relays';
  let view = $state<View>('home');
  let busy = $state(false);
  let error = $state<string | null>(null);

  // join
  let codeInput = $state('');
  let found = $state<Invite | null>(null);
  let mode = $state<'merge' | 'replace'>('replace');

  // invite
  let invite = $state<{ code: string; expiresAt: number } | null>(null);
  let devicesAtInvite = 0;
  let now = $state(Date.now());

  // relays / name
  let relaysText = $state('');
  let nameInput = $state('');
  let spaceName = $state('');
  let confirmLeave = $state(false);
  let renaming = $state(false);
  let renameInput = $state('');
  let testing = $state(false);
  let results = $state<RelayTestResult[]>([]);

  async function runTest() {
    testing = true;
    const urls = [...new Set([...(sync.space?.relays ?? []), ...CANDIDATE_RELAYS])];
    results = urls.map((url) => ({ url, connects: false, accepts: false, acceptsExpiring: false, findable: false, note: 'Testing…' }));
    await Promise.all(
      urls.map(async (url, i) => {
        results[i] = await testRelay(url);
      }),
    );
    testing = false;
  }
  const working = $derived(results.filter(usable).map((r) => r.url));

  $effect(() => {
    if (open && !dialog.open) {
      dialog.showModal();
      reset();
    }
    if (!open && dialog.open) dialog.close();
  });

  $effect(() => {
    if (!invite) return;
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  function reset() {
    view = 'home';
    error = null;
    busy = false;
    codeInput = '';
    found = null;
    invite = null;
    confirmLeave = false;
    renaming = false;
    nameInput = app.settings.deviceName || guessDeviceName();
    spaceName = '';
  }

  async function run(fn: () => Promise<void>) {
    busy = true;
    error = null;
    try {
      await fn();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function saveName() {
    const v = nameInput.trim();
    if (v && v !== app.settings.deviceName) await app.setSetting('deviceName', v);
  }

  function startRename(current: string) {
    renameInput = current;
    renaming = true;
  }

  const rename = () =>
    run(async () => {
      await sync.rename(renameInput);
      renaming = false;
    });

  const start = () =>
    run(async () => {
      await saveName();
      await sync.createSpace(spaceName);
    });

  const lookUp = () =>
    run(async () => {
      found = await sync.findInvite(codeInput);
      // Keep real tasks by default; a fresh device with only the examples starts clean.
      mode = app.tasks.some((t) => !isExampleTask(t)) ? 'merge' : 'replace';
    });

  const join = () =>
    run(async () => {
      await saveName();
      await sync.acceptInvite(found!, mode);
      app.toast(`Joined "${found!.name}". Your tasks will appear as they arrive.`);
      found = null;
      view = 'home';
    });

  const makeInvite = () =>
    run(async () => {
      invite = await sync.createInvite();
      devicesAtInvite = sync.devices.length;
      view = 'invite';
    });

  function ago(ms: number | null) {
    if (!ms) return 'never';
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  const statusText = $derived.by(() => {
    if (sync.status === 'offline') return sync.pending ? `Offline · ${sync.pending} waiting to send` : 'Offline · changes are kept here';
    if (sync.status === 'connecting') return 'Connecting to relays…';
    if (sync.pending) return `Sending ${sync.pending} ${sync.pending === 1 ? 'change' : 'changes'}…`;
    return `Up to date · ${ago(sync.lastSyncAt)}`;
  });

  const remaining = $derived(invite ? Math.max(0, Math.round((invite.expiresAt - now) / 1000)) : 0);
  const joinedSinceInvite = $derived(invite != null && sync.devices.length > devicesAtInvite);
  const relayCount = $derived(Object.values(sync.relayState).filter(Boolean).length);
</script>

<dialog
  bind:this={dialog}
  class="sync"
  aria-labelledby="sync-h"
  onclose={() => (open = false)}
  onclick={(e) => e.target === dialog && (open = false)}
>
  <div class="inner">
    <div class="top">
      {#if view !== 'home'}
        <button class="icon-btn back" aria-label="Back" onclick={() => ((view = 'home'), (error = null), (invite = null))}>
          <Icon name="left" />
        </button>
      {/if}
      <h2 id="sync-h">
        {view === 'join' ? 'Join with a code' : view === 'invite' ? 'Add a device or person' : view === 'relays' ? 'Relays' : 'Sync'}
      </h2>
      <button class="icon-btn" aria-label="Close" onclick={() => (open = false)}><Icon name="close" /></button>
    </div>

    {#if view === 'home' && !sync.space}
      <p class="lead">
        Keep this planner the same on your phone and computer, or share it with someone. Changes are encrypted on this
        device and passed through public Nostr relays. Only devices you add can read them.
      </p>
      <div class="field">
        <label for="dev-name">This device's name</label>
        <input id="dev-name" bind:value={nameInput} maxlength="60" />
      </div>
      <div class="choices">
        <div class="choice">
          <h3>First device</h3>
          <p>Start a shared planner with the tasks you have here.</p>
          <div class="field">
            <label for="space-name">Planner name</label>
            <input id="space-name" bind:value={spaceName} placeholder="My planner" maxlength="60" />
          </div>
          <button class="btn primary" disabled={busy} onclick={start}><Icon name="cloud" />Start syncing</button>
        </div>
        <div class="choice">
          <h3>Already syncing elsewhere</h3>
          <p>Get a code on the other device under Sync → Add a device, then enter it here.</p>
          <button class="btn" disabled={busy} onclick={() => (view = 'join')}>Join with a code</button>
        </div>
      </div>
    {:else if view === 'home' && sync.space}
      <div class="status" data-state={sync.status}>
        <span class="dot" aria-hidden="true"></span>
        <span>{statusText}</span>
        <button class="btn small" disabled={busy} onclick={() => run(() => sync.syncNow())}><Icon name="refresh" />Sync now</button>
      </div>

      <section>
        <h3>{sync.space.name}</h3>
        <ul class="devices">
          {#each sync.devices as d (d.pubkey)}
            <li>
              <Icon name="device" />
              {#if d.me && renaming}
                <form
                  class="rename"
                  onsubmit={(e) => {
                    e.preventDefault();
                    rename();
                  }}
                >
                  <!-- svelte-ignore a11y_autofocus -->
                  <input
                    aria-label="This device's name"
                    bind:value={renameInput}
                    maxlength="60"
                    autofocus
                    onkeydown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        renaming = false;
                      }
                    }}
                  />
                  <span class="rename-actions">
                    <button class="btn small primary" disabled={busy || !renameInput.trim()}>Save</button>
                    <button type="button" class="btn small" onclick={() => (renaming = false)}>Cancel</button>
                  </span>
                </form>
              {:else if d.me}
                <span class="dname">{d.name}<span class="me">This device</span></span>
                <button class="icon-btn small" aria-label="Rename this device" title="Rename" onclick={() => startRename(d.name)}>
                  <Icon name="edit" size={16} />
                </button>
              {:else}
                <span class="dname">{d.name}</span>
                <span class="seen">{ago(d.lastSeen)}</span>
              {/if}
            </li>
          {:else}
            <li class="muted">Looking for other devices…</li>
          {/each}
        </ul>
        <button class="btn primary" disabled={busy} onclick={makeInvite}>
          <Icon name="plus" />{busy ? 'Posting code…' : 'Add a device or person'}
        </button>
      </section>

      <section class="meta-links">
        <button class="link" onclick={() => ((relaysText = sync.space!.relays.join('\n')), (view = 'relays'))}>
          Relays · {relayCount} of {sync.space.relays.length} connected
        </button>
        {#if confirmLeave}
          <span class="confirm">
            Stop syncing on this device? Tasks stay here.
            <button class="btn small danger" onclick={() => run(() => sync.leave())}>Stop syncing</button>
            <button class="btn small" onclick={() => (confirmLeave = false)}>Cancel</button>
          </span>
        {:else}
          <button class="link danger" onclick={() => (confirmLeave = true)}>Stop syncing on this device</button>
        {/if}
      </section>
      {#if sync.lastError}<p class="error">{sync.lastError}</p>{/if}
    {:else if view === 'join'}
      {#if !found}
        <p class="lead">On a device that already syncs, open Sync → Add a device or person. Enter the code it shows.</p>
        <form
          class="code-form"
          onsubmit={(e) => {
            e.preventDefault();
            lookUp();
          }}
        >
          <label class="sr-only" for="join-code">Code</label>
          <input
            id="join-code"
            class="code-input"
            bind:value={codeInput}
            placeholder="XXXX-XXXX-XXXX"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            maxlength="16"
          />
          <button class="btn primary" disabled={busy || codeInput.replace(/[\s-]/g, '').length < 12}>
            {busy ? 'Looking…' : 'Find'}
          </button>
        </form>
      {:else}
        <p class="lead">Found <strong>{found.name}</strong>, shared from {found.from}.</p>
        <fieldset class="modes">
          <legend class="sr-only">What happens to the tasks on this device</legend>
          <label class:on={mode === 'replace'}>
            <input type="radio" name="mode" value="replace" bind:group={mode} />
            <span><strong>Use the shared tasks</strong><small>Removes the {app.tasks.length} tasks on this device first.</small></span>
          </label>
          <label class:on={mode === 'merge'}>
            <input type="radio" name="mode" value="merge" bind:group={mode} />
            <span><strong>Add my tasks too</strong><small>Shares the {app.tasks.length} tasks on this device with everyone in the planner.</small></span>
          </label>
        </fieldset>
        <button class="btn primary" disabled={busy} onclick={join}>{busy ? 'Joining…' : `Join "${found.name}"`}</button>
      {/if}
    {:else if view === 'invite' && invite}
      {#if joinedSinceInvite}
        <p class="joined"><Icon name="check" />{sync.devices[sync.devices.length - 1]?.name ?? 'A device'} joined.</p>
      {/if}
      <p class="lead">On the other device, open Weekly → Sync → Join with a code, and enter:</p>
      <output class="code" aria-live="polite">{formatCode(invite.code)}</output>
      <p class="muted center">
        {#if remaining > 0}
          Works once, for {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')} more.
        {:else}
          This code has expired. <button class="link" onclick={makeInvite}>Get a new one</button>
        {/if}
      </p>
      <p class="muted small">
        Anyone with this code can join and see and change every task in this planner. Share it only with people you trust,
        and only in person or in a private message.
      </p>
    {:else if view === 'relays' && sync.space}
      <p class="lead">Relays pass encrypted changes between devices and hold them while devices are offline. Every device in the planner should use at least one shared relay.</p>
      <ul class="relays">
        {#each sync.space.relays as r (r)}
          <li><span class="dot" class:on={sync.relayState[r]}></span>{r}</li>
        {/each}
      </ul>
      <div class="field">
        <label for="relays">One relay per line</label>
        <textarea id="relays" rows="5" bind:value={relaysText} spellcheck="false"></textarea>
      </div>
      <section class="test">
        <div class="row">
          <button class="btn" disabled={testing} onclick={runTest}>{testing ? 'Testing relays…' : 'Test relays'}</button>
          {#if !testing && working.length}
            <button
              class="btn primary"
              disabled={busy}
              onclick={() =>
                run(async () => {
                  await sync.setRelays(working);
                  relaysText = working.join('\n');
                })}>Use the {working.length} working {working.length === 1 ? 'relay' : 'relays'}</button
            >
          {/if}
        </div>
        {#if results.length}
          <ul class="results">
            {#each results as r (r.url)}
              <li class:ok={usable(r)} class:bad={r.note !== 'Testing…' && !usable(r)}>
                <span class="dot" class:on={usable(r)}></span>
                <span class="rurl">{r.url.replace('wss://', '')}</span>
                <span class="rnote">{r.note}</span>
              </li>
            {/each}
          </ul>
          {#if !testing && !working.length}
            <p class="error">No relay works from this network. Try another network (for example your phone's mobile data), or turn off VPN, DNS filtering or blocking extensions for this site.</p>
          {/if}
        {/if}
      </section>
      <div class="row">
        <button
          class="btn primary"
          disabled={busy}
          onclick={() =>
            run(async () => {
              const list = relaysText
                .split(/\s+/)
                .map((s) => s.trim())
                .filter((s) => /^wss?:\/\/\S+$/.test(s));
              if (!list.length) throw new Error('Add at least one relay address starting with wss://');
              await sync.setRelays(list);
              view = 'home';
            })}>Save relays</button
        >
        <button class="btn" onclick={() => (relaysText = DEFAULT_RELAYS.join('\n'))}>Use defaults</button>
      </div>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
</dialog>

<style>
  .sync {
    width: min(520px, calc(100vw - 32px));
    max-height: calc(100dvh - 48px);
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--card);
    color: var(--ink);
    box-shadow: var(--shadow-lift);
  }
  .sync::backdrop {
    background: var(--scrim);
  }
  .inner {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px 20px 22px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-right: -8px;
  }
  .back {
    margin-left: -10px;
  }
  h2 {
    flex: 1;
    margin: 0;
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 650;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-2);
  }
  .lead {
    margin: 0;
    color: var(--ink-2);
    max-width: 58ch;
  }
  .muted {
    margin: 0;
    color: var(--ink-3);
  }
  .small {
    font-size: 12.5px;
  }
  .center {
    text-align: center;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  label,
  .field label {
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-2);
  }
  input:not([type='radio']),
  textarea {
    height: 38px;
    min-width: 0;
    padding: 0 10px;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-sm);
    background: var(--surface);
    font-size: 15px;
  }
  textarea {
    height: auto;
    padding: 8px 10px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 13px;
    resize: vertical;
  }
  .choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .choice {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--surface);
  }
  .choice p {
    flex: 1;
    margin: 0;
    font-size: 13px;
    color: var(--ink-2);
  }
  .choice .btn {
    justify-content: center;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--r-md);
    background: var(--surface);
    border: 1px solid var(--line);
  }
  .status span:nth-child(2) {
    flex: 1;
  }
  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--ink-3);
  }
  .status[data-state='online'] .dot,
  .dot.on {
    background: var(--done);
  }
  .status[data-state='connecting'] .dot {
    background: var(--hl);
  }
  .status[data-state='offline'] .dot {
    background: var(--late);
  }
  .btn.small {
    height: 30px;
    padding: 0 10px;
    font-size: 13px;
  }
  .btn.small :global(svg) {
    width: 15px;
    height: 15px;
  }
  .devices,
  .relays {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0 0 12px;
    padding: 0;
    list-style: none;
  }
  .devices li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 36px;
    color: var(--ink-2);
  }
  .dname {
    flex: 1;
    min-width: 0;
    color: var(--ink);
    font-weight: 500;
  }
  .me {
    margin-left: 8px;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 11.5px;
    font-weight: 600;
  }
  .rename {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
    min-width: 0;
    padding: 2px 0;
  }
  /* On narrow phones the buttons wrap below the field rather than squeezing it. */
  .rename input {
    flex: 1 1 160px;
    height: 34px;
  }
  .rename-actions {
    display: flex;
    gap: 6px;
  }
  .icon-btn.small {
    width: 30px;
    height: 30px;
  }
  .seen {
    font-size: 12.5px;
    color: var(--ink-3);
  }
  .relays li {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .results {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
    font-size: 13px;
  }
  .results li {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 2px 10px;
  }
  .rurl {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    overflow-wrap: anywhere;
  }
  .rnote {
    grid-column: 2;
    color: var(--ink-3);
    font-size: 12.5px;
    overflow-wrap: anywhere;
  }
  .results li.ok .rnote {
    color: var(--done);
  }
  .results li.bad .rnote {
    color: var(--late);
  }
  .meta-links {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-weight: 500;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .link.danger,
  .btn.danger {
    color: var(--late);
  }
  .confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .code-form {
    display: flex;
    gap: 8px;
  }
  .code-input {
    flex: 1;
    height: 48px !important;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 20px !important;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    text-align: center;
  }
  .code-form .btn {
    height: 48px;
  }
  .code {
    display: block;
    padding: 18px 12px;
    border-radius: var(--r-md);
    background: var(--surface);
    border: 1px dashed var(--line-strong);
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: clamp(22px, 7vw, 32px);
    font-weight: 600;
    letter-spacing: 0.14em;
    text-align: center;
    user-select: all;
  }
  .joined {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--done) 14%, transparent);
    color: var(--done);
    font-weight: 600;
  }
  .modes {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .modes label {
    display: flex;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    text-transform: none;
    letter-spacing: 0;
    font-size: 14px;
    font-weight: 400;
    color: var(--ink);
    cursor: pointer;
  }
  .modes label.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .modes input {
    margin-top: 3px;
    accent-color: var(--accent);
  }
  .modes span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .modes small {
    color: var(--ink-2);
    font-size: 13px;
  }
  .error {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--r-md);
    background: var(--late-soft);
    color: var(--late);
    font-size: 13.5px;
  }
  @media (max-width: 560px) {
    .choices {
      grid-template-columns: 1fr;
    }
  }
</style>
