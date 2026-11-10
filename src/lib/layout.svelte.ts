/** Responsive mode, driven by media queries rather than user agent sniffing. */
class Layout {
  /** Phone: days stacked vertically, backlog in a bottom sheet. */
  mobile = $state(false);
  /** Wide desktop: backlog panel docked beside the week. */
  wide = $state(false);

  constructor() {
    const m = matchMedia('(max-width: 719px)');
    const w = matchMedia('(min-width: 1180px)');
    const sync = () => {
      this.mobile = m.matches;
      this.wide = w.matches;
    };
    sync();
    m.addEventListener('change', sync);
    w.addEventListener('change', sync);
  }
}

export const layout = new Layout();
