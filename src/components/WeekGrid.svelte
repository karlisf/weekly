<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { isWeekend, weekDays } from '../lib/dates';
  import DayColumn from './DayColumn.svelte';

  const days = $derived(weekDays(app.weekStart));

  // Weekdays share space equally, the weekend gets less, and the wide day
  // (the clicked one, or today) gets the most.
  const columns = $derived(
    days
      .map((d) => {
        if (d === app.wideDay) return 'minmax(190px, 1.7fr)';
        return isWeekend(d) ? 'minmax(92px, 0.62fr)' : 'minmax(118px, 1fr)';
      })
      .join(' '),
  );
</script>

<div class="scroller" data-scroll>
  <div class="grid" style:grid-template-columns={columns}>
    {#each days as day (day)}
      <DayColumn {day} />
    {/each}
  </div>
</div>

<style>
  .scroller {
    height: 100%;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .grid {
    display: grid;
    height: 100%;
    transition: grid-template-columns 0.22s ease;
    border-left: 1px solid var(--line);
  }
</style>
