/*
 * Pointer-based drag and drop that works the same with mouse, pen and touch.
 * Mouse drags start after a small move; touch drags start after a long press,
 * so normal swipes still scroll.
 *
 * Drop targets are plain DOM attributes:
 *   data-drop-day="YYYY-MM-DD" | data-drop-day=""   (empty = "No date")
 *   data-drop-before="<task id>"                    (insert before this card)
 */
import type { Day } from './dates';
import type { DropTarget } from './store.svelte';

export interface DragPayload {
  taskId: string;
  /** Day column the card was grabbed from; null when grabbed from a panel. */
  fromDay: Day | null;
}

type DropHandler = (p: DragPayload, t: DropTarget) => void;

class DragState {
  active = $state<DragPayload | null>(null);
  over = $state<DropTarget | null>(null);
  onDrop: DropHandler = () => {};
  onStart: () => void = () => {};
}

export const drag = new DragState();

const LONG_PRESS_MS = 260;
const MOUSE_SLOP = 5;
const TOUCH_SLOP = 8;
const EDGE = 56;

export function draggable(node: HTMLElement, payload: DragPayload) {
  let current = payload;
  let startX = 0;
  let startY = 0;
  let pointerId = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  let ghost: HTMLElement | null = null;
  let offsetX = 0;
  let offsetY = 0;
  let lastX = 0;
  let lastY = 0;
  let raf = 0;

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || drag.active) return;
    if ((e.target as HTMLElement).closest('input, textarea, [data-no-drag]')) return;
    pointerId = e.pointerId;
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;
    pending = true;
    if (e.pointerType !== 'mouse') timer = setTimeout(() => pending && begin(), LONG_PRESS_MS);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  function onMove(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    lastX = e.clientX;
    lastY = e.clientY;
    const dist = Math.hypot(lastX - startX, lastY - startY);
    if (pending) {
      if (e.pointerType === 'mouse') {
        if (dist > MOUSE_SLOP) begin();
      } else if (dist > TOUCH_SLOP) {
        cleanup(); // the user is scrolling
      }
      return;
    }
    if (ghost) moveGhost();
  }

  function begin() {
    pending = false;
    clearTimeout(timer);
    const rect = node.getBoundingClientRect();
    offsetX = startX - rect.left;
    offsetY = startY - rect.top;
    ghost = node.cloneNode(true) as HTMLElement;
    ghost.classList.add('drag-ghost');
    Object.assign(ghost.style, { width: `${rect.width}px`, height: `${rect.height}px` });
    document.body.appendChild(ghost);
    node.classList.add('drag-source');
    document.documentElement.classList.add('is-dragging');
    navigator.vibrate?.(8);
    drag.active = current;
    drag.onStart();
    moveGhost();
    raf = requestAnimationFrame(autoScroll);
  }

  function moveGhost() {
    if (!ghost) return;
    ghost.style.transform = `translate(${lastX - offsetX}px, ${lastY - offsetY}px) rotate(-1.5deg)`;
    drag.over = hitTest(lastX, lastY);
  }

  function autoScroll() {
    if (!ghost) return;
    const under = document.elementFromPoint(lastX, lastY);
    let el = under?.closest<HTMLElement>('[data-scroll]') ?? null;
    while (el) {
      const r = el.getBoundingClientRect();
      const dy = lastY < r.top + EDGE ? -1 : lastY > r.bottom - EDGE ? 1 : 0;
      const dx = lastX < r.left + EDGE ? -1 : lastX > r.right - EDGE ? 1 : 0;
      if ((dy && el.scrollHeight > el.clientHeight) || (dx && el.scrollWidth > el.clientWidth)) {
        el.scrollBy(dx * 12, dy * 12);
        drag.over = hitTest(lastX, lastY);
        break;
      }
      el = el.parentElement?.closest<HTMLElement>('[data-scroll]') ?? null;
    }
    raf = requestAnimationFrame(autoScroll);
  }

  function onUp(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    if (ghost) {
      const target = hitTest(e.clientX, e.clientY);
      const p = current;
      // Swallow the click that follows a drag so the card doesn't open.
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      cleanup();
      if (target) drag.onDrop(p, target);
    } else cleanup();
  }

  function onCancel() {
    cleanup();
  }

  function cleanup() {
    pending = false;
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    ghost?.remove();
    ghost = null;
    node.classList.remove('drag-source');
    document.documentElement.classList.remove('is-dragging');
    drag.active = null;
    drag.over = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  }

  // Once a touch drag has started, stop the page from scrolling under the finger.
  function onTouchMove(e: TouchEvent) {
    if (ghost || pending) {
      if (ghost && e.cancelable) e.preventDefault();
    }
  }
  function onContextMenu(e: Event) {
    if (pending || ghost) e.preventDefault();
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('touchmove', onTouchMove, { passive: false });
  node.addEventListener('contextmenu', onContextMenu);

  return {
    update(p: DragPayload) {
      current = p;
    },
    destroy() {
      cleanup();
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('contextmenu', onContextMenu);
    },
  };
}

function swallow(e: Event) {
  e.stopPropagation();
  e.preventDefault();
}

function hitTest(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const zone = el?.closest<HTMLElement>('[data-drop-day]');
  if (!zone) return null;
  const day = zone.dataset.dropDay || null;
  // Insert before the card under the pointer, or before the next one when below its middle.
  const card = el?.closest<HTMLElement>('[data-drop-before]');
  let beforeId: string | undefined;
  if (card && zone.contains(card)) {
    const r = card.getBoundingClientRect();
    if (y < r.top + r.height / 2) beforeId = card.dataset.dropBefore;
    else {
      const cards = [...zone.querySelectorAll<HTMLElement>('[data-drop-before]')];
      const next = cards[cards.indexOf(card) + 1];
      beforeId = next?.dataset.dropBefore;
    }
  }
  return { day, beforeId };
}
