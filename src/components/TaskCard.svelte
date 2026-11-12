<script lang="ts">
  import type { Task } from '../db/schema';
  import { app } from '../lib/store.svelte';
  import { draggable, drag } from '../lib/dnd.svelte';
  import { diffDays, fmt, type Day } from '../lib/dates';
  import { isDelayed, lastDay } from '../lib/plan';
  import Icon from './Icon.svelte';

  let {
    task,
    day = null,
    kind = 'full',
    index = 1,
    length = 1,
    where = 'day',
  }: {
    task: Task;
    /** Column the card sits in; null in panels. */
    day?: Day | null;
    kind?: 'full' | 'continuation';
    index?: number;
    length?: number;
    /** 'anytime' = an undated task shown on today's column. */
    where?: 'day' | 'delayed' | 'nodate' | 'anytime';
  } = $props();

  const done = $derived(task.doneAt != null);
  const late = $derived(isDelayed(task, app.today));
  const daysLate = $derived(late ? diffDays(lastDay(task)!, app.today) : 0);
  const pencil = $derived(where === 'anytime' || where === 'nodate');
  const dropHere = $derived(
    drag.active != null && drag.active.taskId !== task.id && drag.over?.beforeId === task.id && drag.over.day === day,
  );

  function spanLabel(): string {
    const end = lastDay(task)!;
    if (index === 1) return `${length} days · to ${fmt(end, { weekday: 'short' })}`;
    return `Day ${index} of ${length}`;
  }

  function open() {
    app.openTaskId = task.id;
  }
</script>

{#if kind === 'continuation'}
  <button
    class="cont"
    class:done
    class:late
    class:drop-here={dropHere}
    data-drop-before={task.id}
    use:draggable={{ taskId: task.id, fromDay: day }}
    onclick={open}
    title="{task.title} (day {index} of {length})"
  >
    <span class="cont-line" aria-hidden="true"></span>
    <span class="cont-title">{task.title}</span>
    <span class="cont-idx">{index}/{length}</span>
  </button>
{:else}
  <div
    class="card"
    class:done
    class:late={late && where !== 'delayed'}
    class:pencil
    class:spans={length > 1}
    class:span-start={length > 1 && index === 1}
    class:span-mid={length > 1 && index > 1}
    class:drop-here={dropHere}
    data-drop-before={where === 'delayed' ? undefined : task.id}
    use:draggable={{ taskId: task.id, fromDay: where === 'day' ? day : null }}
  >
    <button
      class="check"
      data-no-drag
      aria-pressed={done}
      aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
      onclick={() => app.toggleDone(task.id)}
    >
      {#if done}<Icon name="check" size={14} />{/if}
    </button>
    <button class="body" onclick={open}>
      <span class="title">{task.title}</span>
      {#if length > 1 || late || where === 'delayed' || where === 'anytime' || task.notes}
        <span class="meta">
          {#if where === 'delayed'}
            <span class="chip late-chip">{daysLate} {daysLate === 1 ? 'day' : 'days'} late</span>
            <span class="when">{fmt(lastDay(task)!, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
          {:else if late}
            <span class="chip late-chip">Late</span>
          {/if}
          {#if where === 'anytime'}<span class="chip pencil-chip">No date</span>{/if}
          {#if length > 1}
            <span class="chip span-chip"><Icon name="span" size={12} />{spanLabel()}</span>
          {/if}
          {#if task.notes}<span class="notes-ico" title="Has notes"><Icon name="notes" size={13} /></span>{/if}
        </span>
      {/if}
    </button>
  </div>
{/if}

<style>
  .card {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px 8px 8px;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    box-shadow: var(--shadow);
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    cursor: grab;
  }
  .card:hover {
    border-color: var(--line-strong);
  }
  /* A multi-day task reads as one strip of tape running across the columns. */
  .card.spans {
    background: linear-gradient(var(--accent-soft), var(--accent-soft)) left / 3px 100% no-repeat, var(--card);
  }
  .card.span-mid {
    border-top-left-radius: 3px;
    border-bottom-left-radius: 3px;
  }
  /* Pencilled in: undated tasks are drawn, not inked. */
  .card.pencil {
    background: transparent;
    border-style: dashed;
    border-color: var(--line-strong);
    box-shadow: none;
  }
  .card.pencil .title {
    color: var(--ink-2);
  }
  .card.done {
    background: transparent;
    box-shadow: none;
    border-color: var(--line);
  }
  .card.done .title {
    color: var(--ink-3);
    text-decoration: line-through;
    text-decoration-color: var(--ink-3);
  }
  .drop-here::before {
    content: '';
    position: absolute;
    left: 4px;
    right: 4px;
    top: -6px;
    height: 3px;
    border-radius: 2px;
    background: var(--accent);
  }

  .check {
    flex: none;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    margin-top: 1px;
    padding: 0;
    border: 1.5px solid var(--ink-3);
    border-radius: 50%;
    background: transparent;
    color: var(--card);
    position: relative;
  }
  /* Bigger touch target without a bigger circle. */
  .check::after {
    content: '';
    position: absolute;
    inset: -10px;
  }
  .check:hover {
    border-color: var(--done);
  }
  .card.late .check {
    border-color: var(--late);
  }
  .check[aria-pressed='true'] {
    background: var(--done);
    border-color: var(--done);
  }

  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    cursor: inherit;
  }
  .title {
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    font-size: 12px;
    color: var(--ink-2);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 20px;
    max-width: 100%;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .late-chip {
    background: var(--late-soft);
    color: var(--late);
  }
  .pencil-chip {
    border: 1px dashed var(--line-strong);
    color: var(--ink-2);
    font-weight: 500;
  }
  .span-chip {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .when {
    font-variant-numeric: tabular-nums;
  }
  .notes-ico {
    display: inline-flex;
    color: var(--ink-3);
  }

  /* Middle days of a multi-day task: a slim line, so long spans don't crowd the week. */
  .cont {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 28px;
    padding: 4px 8px;
    border: 0;
    border-radius: var(--r-sm);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 12.5px;
    text-align: left;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    touch-action: manipulation;
    cursor: grab;
  }
  .cont.done {
    opacity: 0.55;
  }
  .cont.late {
    background: var(--late-soft);
    color: var(--late);
  }
  .cont-line {
    flex: none;
    width: 10px;
    height: 2px;
    background: currentColor;
    border-radius: 1px;
  }
  .cont-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink-2);
  }
  .cont-idx {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
</style>
