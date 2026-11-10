<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { drag } from '../lib/dnd.svelte';
  import { delayedTasks, unscheduledTasks } from '../lib/plan';
  import TaskCard from './TaskCard.svelte';
  import QuickAdd from './QuickAdd.svelte';
  import Icon from './Icon.svelte';

  const delayed = $derived(delayedTasks(app.tasks, app.today));
  const undated = $derived(unscheduledTasks(app.tasks));
  const overUndated = $derived(drag.active != null && drag.over != null && drag.over.day === null);
  const dropAtEnd = $derived(overUndated && drag.over?.beforeId === undefined);

  let adding = $state(false);
</script>

<div class="backlog" data-scroll>
  <section class="sec" aria-labelledby="delayed-h">
    <h2 id="delayed-h">
      Delayed {#if delayed.length}<span class="badge late">{delayed.length}</span>{/if}
    </h2>
    {#if delayed.length}
      <div class="list">
        {#each delayed as t (t.id)}
          <TaskCard task={t} where="delayed" />
        {/each}
      </div>
    {:else}
      <p class="empty">Nothing is late. Open tasks land here once their last day has passed.</p>
    {/if}
  </section>

  <section class="sec drop" class:over={overUndated} data-drop-day="" aria-labelledby="undated-h">
    <h2 id="undated-h">
      No date {#if undated.length}<span class="badge">{undated.length}</span>{/if}
    </h2>
    <div class="list">
      {#each undated as t (t.id)}
        <TaskCard task={t} where="nodate" />
      {/each}
      {#if dropAtEnd}<div class="drop-end" aria-hidden="true"></div>{/if}
      {#if !undated.length && !adding}
        <p class="empty">Tasks without a day. Drop a card here to unschedule it.</p>
      {/if}
      {#if adding}
        <QuickAdd day={null} placeholder="Task for whenever" onclose={() => (adding = false)} />
      {:else}
        <button class="add" onclick={() => (adding = true)}><Icon name="plus" size={16} />Add task without a date</button>
      {/if}
    </div>
  </section>

  <p class="storage" class:warn={!app.persistent}>
    {#if app.persistent}
      Saved in this browser only. Export a backup from the menu.
    {:else}
      This browser can't keep data here, so changes are lost when you close the page. Try a regular (not private)
      window in an up-to-date browser.
    {/if}
  </p>
</div>

<style>
  .backlog {
    display: flex;
    flex-direction: column;
    gap: 22px;
    height: 100%;
    overflow-y: auto;
    padding: 16px 16px 24px;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 10px;
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 650;
    letter-spacing: -0.005em;
  }
  .badge {
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 10px;
    background: var(--line);
    color: var(--ink-2);
    font-family: var(--font-body);
    font-size: 11.5px;
    font-weight: 700;
    line-height: 20px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .badge.late {
    background: var(--late-soft);
    color: var(--late);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .drop {
    margin: -8px;
    padding: 8px;
    border-radius: var(--r-md);
    border: 1px dashed transparent;
  }
  .drop.over {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .drop-end {
    height: 3px;
    border-radius: 2px;
    background: var(--accent);
  }
  .empty {
    margin: 0;
    color: var(--ink-3);
    font-size: 13px;
    max-width: 40ch;
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
  }
  .add:hover {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .storage {
    margin: auto 0 0;
    font-size: 12px;
    color: var(--ink-3);
  }
  .storage.warn {
    padding: 10px 12px;
    border-radius: var(--r-md);
    background: var(--late-soft);
    color: var(--late);
  }
</style>
