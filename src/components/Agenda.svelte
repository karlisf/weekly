<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { drag } from '../lib/dnd.svelte';
  import { fmt, isWeekend, weekDays } from '../lib/dates';
  import { placementsForDay } from '../lib/plan';
  import DayColumn from './DayColumn.svelte';

  const days = $derived(weekDays(app.weekStart));

  function jump(day: string) {
    document.getElementById(`day-${day}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Bring today into view when the current week is shown.
  $effect(() => {
    if (app.status.kind !== 'ready') return;
    if (days.includes(app.today)) requestAnimationFrame(() => jump(app.today));
    else window.scrollTo({ top: 0 });
  });
</script>

<!-- Week strip: tap to jump, drop a card on a day to move it there. -->
<nav class="strip" aria-label="Days of the week">
  {#each days as day (day)}
    {@const n = placementsForDay(app.tasks, day, app.today, app.weekStart).filter((p) => p.task.doneAt == null).length}
    <button
      class="pill"
      class:today={day === app.today}
      class:weekend={isWeekend(day)}
      class:past={day < app.today}
      class:over={drag.active != null && drag.over?.day === day}
      data-drop-day={day}
      onclick={() => jump(day)}
    >
      <span class="d">{fmt(day, { weekday: 'narrow' })}</span>
      <span class="n">{fmt(day, { day: 'numeric' })}</span>
      <span class="dots" aria-label="{n} open">{#each { length: Math.min(n, 3) } as _}<i></i>{/each}</span>
    </button>
  {/each}
</nav>

<div class="days">
  {#each days as day (day)}
    <DayColumn {day} />
  {/each}
</div>

<style>
  .strip {
    position: sticky;
    top: calc(var(--topbar-h) + env(safe-area-inset-top, 0px));
    z-index: 5;
    display: grid;
    grid-template-columns: repeat(5, 1fr) repeat(2, 0.8fr);
    gap: 4px;
    height: 60px;
    padding: 6px max(12px, env(safe-area-inset-right, 0px)) 6px max(12px, env(safe-area-inset-left, 0px));
    background: var(--bg);
    border-bottom: 1px solid var(--line);
  }
  .pill {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    padding: 0;
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
  }
  .pill.weekend {
    color: var(--ink-2);
  }
  .pill.past {
    color: var(--ink-3);
  }
  .d {
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.06em;
  }
  .n {
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 650;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .pill.today .n {
    padding: 0 4px;
    border-radius: 3px;
    background: var(--hl);
    color: #17201c;
  }
  .pill.over {
    background: var(--accent-soft);
    outline: 2px solid var(--accent);
  }
  .dots {
    display: flex;
    gap: 2px;
    height: 4px;
  }
  .dots i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--accent);
  }
  .days {
    padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px));
  }
</style>
