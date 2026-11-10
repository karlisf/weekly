<script lang="ts">
  const paths = {
    left: 'M15 18l-6-6 6-6',
    right: 'M9 18l6-6-6-6',
    plus: 'M12 5v14M5 12h14',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    close: 'M6 6l12 12M18 6L6 18',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    notes: 'M5 7h14M5 12h14M5 17h9',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    inbox: 'M4 13l2.5-8h11L20 13M4 13v6h16v-6M4 13h5l1 2h4l1-2h5',
    span: 'M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4',
    clock: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    cloud: 'M7 18h10.5a4 4 0 00.4-7.98A6 6 0 006.2 8.6 4.7 4.7 0 007 18z',
    cloudOff: 'M3 3l18 18M8.5 6.6A6 6 0 0117.9 10a4 4 0 012.4 6.6M17 18H7a4.7 4.7 0 01-1.3-9.2',
    device: 'M8 3h8a1 1 0 011 1v16a1 1 0 01-1 1H8a1 1 0 01-1-1V4a1 1 0 011-1zM11 18h2',
    refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  } as const;
  let { name, size = 18 }: { name: keyof typeof paths; size?: number } = $props();
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width={name === 'more' ? 3 : 2}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"><path d={paths[name]} /></svg>
