<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { layout } from '../lib/layout.svelte';
  import { drag } from '../lib/dnd.svelte';
  import { fmt, isWeekend, type Day } from '../lib/dates';
  import { delayedTasks, placementsForDay, unscheduledTasks } from '../lib/plan';
  import TaskCard from './TaskCard.svelte';
  import QuickAdd from './QuickAdd.svelte';
  import Icon from './Icon.svelte';

  let { day }: { day: Day } = $props();

  const isToday = $derived(day === app.today);
  const wide = $derived(!layout.mobile && day === app.wideDay);
  const focus = () => {
    if (!layout.mobile) app.focusDay = day;
  };
  const isPast = $derived(day < app.today);
  const weekend = $derived(isWeekend(day));
  const placements = $derived(placementsForDay(app.tasks, day, app.today, app.weekStart));
  const carried = $derived(isToday && app.settings.delayedOnToday ? delayedTasks(app.tasks, app.today) : []);
  const anytime = $derived(isToday && app.settings.unscheduledOnToday ? unscheduledTasks(app.tasks) : []);
  const doneCount = $derived(placements.filter((p) => p.task.doneAt != null).length);
  const over = $derived(drag.active != null && drag.over?.day === day);
  const dropAtEnd = $derived(over && drag.over?.beforeId === undefined);
  const overAnytime = $derived(drag.active != null && isToday && drag.over != null && drag.over.day === null);

  let adding = $state(false);

  $effect(() => {
    if (app.quickAddDay === day) {
      adding = true;
      app.quickAddDay = null;
    }
  });
</script>

<!-- Clicking anywhere in a column widens it (mouse convenience); the header button does the same from the keyboard. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<section
  class="day"
  class:wide
  onclick={focus}
  class:today={isToday}
  class:past={isPast}
  class:weekend
  class:over
  id="day-{day}"
  data-drop-day={day}
  aria-label={fmt(day, { weekday: 'long', day: 'numeric', month: 'long' })}
>
  <button class="head" aria-pressed={wide} aria-label="Widen {fmt(day, { weekday: 'long', day: 'numeric' })}" onclick={focus}>
    <span class="dow">{fmt(day, { weekday: wide || (layout.mobile && !weekend) ? 'long' : 'short' })}</span>
    <span class="num">{fmt(day, { day: 'numeric' })}</span>
    {#if isToday}<span class="today-tag">Today</span>{/if}
    {#if placements.length}
      <span class="count" title="{doneCount} of {placements.length} done">{doneCount}/{placements.length}</span>
    {/if}
  </button>

  <div class="list" data-scroll>
    {#each placements as p (p.task.id)}
      <TaskCard task={p.task} {day} kind={p.kind} index={p.index} length={p.length} />
    {/each}
    {#if dropAtEnd}<div class="drop-end" aria-hidden="true"></div>{/if}

    {#if adding}
      <QuickAdd {day} onclose={() => (adding = false)} />
    {:else}
      <button class="add" onclick={() => (adding = true)}>
        <Icon name="plus" size={16} /><span>Add task</span>
      </button>
    {/if}

    <!-- Dropping here schedules the card on today, at the end. -->
    {#if carried.length}
      <div class="carried" data-drop-day={day}>
        <div class="section-label">Late · carried over to today</div>
        {#each carried as t (t.id)}
          <TaskCard task={t} {day} where="delayed" />
        {/each}
      </div>
    {/if}

    {#if anytime.length || overAnytime}
      <div class="anytime" class:over={overAnytime} data-drop-day="">
        <div class="section-label">No date · pencilled in for today</div>
        {#each anytime as t (t.id)}
          <TaskCard task={t} {day} where="anytime" />
        {/each}
      </div>
    {/if}
  </div>
</section>

<style>
  .day {
    --pad: 10px;
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--surface);
    border-right: 1px solid var(--line);
    transition: background-color 0.12s;
  }
  .day.weekend {
    background: color-mix(in srgb, var(--surface) 55%, var(--bg));
  }
  .day.today {
    background: var(--hl-wash);
  }
  .day.over {
    background: var(--accent-soft);
  }

  .head {
    width: 100%;
    margin: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 2px 8px;
    padding: 12px var(--pad) 10px;
    border-bottom: 1px solid var(--line);
  }
  .dow {
    font-size: 11.5px;
    font-weight: 650;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-2);
  }
  .num {
    order: -1;
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 650;
    line-height: 1;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .past .num,
  .past .dow {
    color: var(--ink-3);
  }
  /* Today's date gets a highlighter stroke. */
  .today .num {
    padding: 2px 5px 1px;
    margin: -2px 0 -1px -5px;
    border-radius: 3px;
    background: var(--hl);
    /* Dark ink on yellow in both themes, like a real highlighter. */
    color: #17201c;
  }
  .today-tag {
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink);
  }
  .count {
    margin-left: auto;
    font-size: 12px;
    color: var(--ink-3);
    font-variant-numeric: tabular-nums;
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--pad);
    padding-bottom: 24px;
  }
  .drop-end {
    height: 3px;
    margin: -1px 4px 0;
    border-radius: 2px;
    background: var(--accent);
  }

  .add {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 34px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--ink-3);
    font-weight: 500;
    text-align: left;
  }
  .add:hover,
  .add:focus-visible {
    background: color-mix(in srgb, var(--accent-soft) 70%, transparent);
    color: var(--accent);
  }
  .day:not(:hover):not(.wide) .add span {
    opacity: 0;
  }
  .day:focus-within .add span {
    opacity: 1;
  }

  .carried,
  .anytime {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 6px;
    padding: 8px;
    border-radius: var(--r-md);
    border: 1px dashed var(--line-strong);
  }
  .carried {
    border-color: color-mix(in srgb, var(--late) 45%, transparent);
  }
  .anytime.over {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .section-label {
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-3);
  }

  /* Phone: days stack vertically and the page scrolls, not each day. */
  @media (max-width: 719px) {
    .day {
      border-right: 0;
      border-bottom: 1px solid var(--line);
      scroll-margin-top: calc(var(--topbar-h) + 64px);
    }
    .head {
      position: sticky;
      top: calc(var(--topbar-h) + 60px + env(safe-area-inset-top, 0px));
      z-index: 2;
      background: inherit;
      padding: 10px 16px 8px;
      border-bottom: 0;
    }
    .day.weekend .head {
      padding-block: 6px 4px;
    }
    .day.weekend .num {
      font-size: 20px;
    }
    .list {
      overflow: visible;
      padding: 0 16px 14px;
    }
    .day.weekend .list {
      padding-bottom: 8px;
    }
    .add span {
      opacity: 1 !important;
    }
  }
</style>
