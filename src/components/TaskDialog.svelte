<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { addDays, diffDays, fmt, relativeDay } from '../lib/dates';
  import { isDelayed, lastDay, spanLength } from '../lib/plan';
  import Icon from './Icon.svelte';

  let dialog: HTMLDialogElement;
  const task = $derived(app.openTask);

  // Local edit buffers so typing isn't interrupted by store updates.
  let title = $state('');
  let notes = $state('');
  let loadedId: string | null = null;

  $effect(() => {
    const t = task;
    if (t && t.id !== loadedId) {
      loadedId = t.id;
      title = t.title;
      notes = t.notes;
    }
    if (t && !dialog.open) dialog.showModal();
    if (!t && dialog.open) dialog.close();
    if (!t) loadedId = null;
  });

  function close() {
    commitText();
    app.openTaskId = null;
  }

  function commitText() {
    const t = app.openTask;
    if (!t) return;
    const patch: { title?: string; notes?: string } = {};
    if (title.trim() && title.trim() !== t.title) patch.title = title.trim();
    if (notes !== t.notes) patch.notes = notes;
    if (Object.keys(patch).length) void app.updateTask(t.id, patch);
  }

  function setStart(v: string) {
    if (!task) return;
    if (!v) return void app.updateTask(task.id, { startDate: null, endDate: null });
    // Moving the start keeps the length of a multi-day task.
    const len = spanLength(task);
    void app.updateTask(task.id, { startDate: v, endDate: len > 1 ? addDays(v, len - 1) : null });
  }

  function setEnd(v: string) {
    if (!task?.startDate) return;
    void app.updateTask(task.id, { endDate: v && v > task.startDate ? v : null });
  }

  function editedLabel(ms: number) {
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const d = new Date(ms);
    return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
</script>

<dialog
  bind:this={dialog}
  class="sheet"
  aria-labelledby="task-title"
  onclose={() => app.openTaskId && close()}
  onclick={(e) => e.target === dialog && close()}
>
  {#if task}
    {@const late = isDelayed(task, app.today)}
    <div class="inner">
      <div class="top">
        <button
          class="done-toggle"
          class:on={task.doneAt != null}
          aria-pressed={task.doneAt != null}
          onclick={() => app.toggleDone(task.id)}
        >
          <span class="box">{#if task.doneAt != null}<Icon name="check" size={14} />{/if}</span>
          {task.doneAt != null ? 'Done' : 'Mark done'}
        </button>
        {#if late}
          <span class="late">{diffDays(lastDay(task)!, app.today)} days late</span>
        {/if}
        <button class="icon-btn close" aria-label="Close" onclick={close}><Icon name="close" /></button>
      </div>

      <label class="sr-only" for="task-title">Title</label>
      <textarea
        id="task-title"
        class="title"
        rows="1"
        bind:value={title}
        onblur={commitText}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitText();
          }
        }}
      ></textarea>

      <div class="dates">
        <div class="field">
          <label for="task-start">Day</label>
          <input id="task-start" type="date" value={task.startDate ?? ''} onchange={(e) => setStart(e.currentTarget.value)} />
        </div>
        <div class="field">
          <label for="task-end">Until <span class="opt">(optional)</span></label>
          <input
            id="task-end"
            type="date"
            disabled={!task.startDate}
            min={task.startDate ? addDays(task.startDate, 1) : undefined}
            value={task.endDate ?? ''}
            onchange={(e) => setEnd(e.currentTarget.value)}
          />
        </div>
      </div>
      <p class="hint">
        {#if !task.startDate}
          No date. It waits in the backlog{app.settings.unscheduledOnToday ? ' and is pencilled in on today' : ''}.
        {:else if task.endDate}
          {spanLength(task)} days, {fmt(task.startDate, { weekday: 'short', day: 'numeric', month: 'short' })} to
          {fmt(task.endDate, { weekday: 'short', day: 'numeric', month: 'short' })}. Shows every day until then; if still
          open after, it moves to Delayed.
        {:else}
          {fmt(task.startDate, { weekday: 'long', day: 'numeric', month: 'long' })}, {relativeDay(task.startDate, app.today)}.
        {/if}
      </p>
      {#if task.startDate}
        <div class="quick-dates">
          <button class="btn" onclick={() => setStart(app.today)}>Today</button>
          <button class="btn" onclick={() => setStart(addDays(app.today, 1))}>Tomorrow</button>
          <button class="btn" onclick={() => setStart('')}>Remove date</button>
        </div>
      {:else}
        <div class="quick-dates">
          <button class="btn" onclick={() => setStart(app.today)}>Today</button>
          <button class="btn" onclick={() => setStart(addDays(app.today, 1))}>Tomorrow</button>
        </div>
      {/if}

      <label class="notes-label" for="task-notes">Notes</label>
      <textarea id="task-notes" class="notes" rows="6" placeholder="Details, links, checklists…" bind:value={notes} onblur={commitText}
      ></textarea>

      <div class="foot">
        <span class="stamp">Created {editedLabel(task.createdAt)} · Edited {editedLabel(task.updatedAt)}</span>
        <button class="btn danger" onclick={() => app.deleteTask(task.id)}><Icon name="trash" />Delete</button>
      </div>
    </div>
  {/if}
</dialog>

<style>
  .sheet {
    width: min(560px, calc(100vw - 32px));
    max-height: min(720px, calc(100dvh - 48px));
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--card);
    color: var(--ink);
    box-shadow: var(--shadow-lift);
  }
  .sheet::backdrop {
    background: var(--scrim);
  }
  .inner {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 20px 20px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .close {
    margin-left: auto;
    margin-right: -8px;
  }
  .done-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 12px 0 8px;
    border: 1px solid var(--line-strong);
    border-radius: 16px;
    background: transparent;
    font-weight: 550;
  }
  .done-toggle .box {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border: 1.5px solid var(--ink-3);
    border-radius: 50%;
    color: var(--card);
  }
  .done-toggle.on {
    border-color: var(--done);
    color: var(--done);
  }
  .done-toggle.on .box {
    background: var(--done);
    border-color: var(--done);
  }
  .late {
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--late-soft);
    color: var(--late);
    font-size: 12px;
    font-weight: 650;
  }
  .title {
    width: 100%;
    padding: 4px 0;
    border: 0;
    background: transparent;
    resize: none;
    field-sizing: content;
    font-family: var(--font-display);
    font-size: 24px;
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: -0.01em;
    outline: none;
  }
  .title:focus-visible {
    box-shadow: 0 2px 0 var(--accent);
  }
  .dates {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  label,
  .notes-label {
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-2);
  }
  .opt {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
    color: var(--ink-3);
  }
  input[type='date'] {
    height: 40px;
    min-width: 0;
    padding: 0 10px;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-sm);
    background: var(--surface);
    font-variant-numeric: tabular-nums;
  }
  input[type='date']:disabled {
    opacity: 0.5;
  }
  .hint {
    margin: -4px 0 0;
    font-size: 13px;
    color: var(--ink-2);
  }
  .quick-dates {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .quick-dates .btn {
    height: 30px;
    font-size: 13px;
  }
  .notes-label {
    margin-top: 4px;
  }
  .notes {
    width: 100%;
    min-height: 120px;
    padding: 10px 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    background: var(--surface);
    resize: vertical;
    field-sizing: content;
    line-height: 1.5;
    font-size: 15px;
  }
  .foot {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 4px;
  }
  .stamp {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: var(--ink-3);
  }

  /* Phone: a bottom sheet. */
  @media (max-width: 719px) {
    .sheet {
      width: 100vw;
      max-width: 100vw;
      max-height: 92dvh;
      margin: auto 0 0;
      border-radius: var(--r-lg) var(--r-lg) 0 0;
      border-bottom: 0;
    }
    .inner {
      padding: 12px max(16px, env(safe-area-inset-right, 0px)) calc(20px + env(safe-area-inset-bottom, 0px))
        max(16px, env(safe-area-inset-left, 0px));
    }
    .title,
    input[type='date'] {
      font-size: 16px;
    }
    .title {
      font-size: 21px;
    }
  }
</style>
