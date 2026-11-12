# Working on Weekly

See README.md for features, layouts and architecture, and docs/SYNC.md for how sync works.

## Verify every UI change on phone AND desktop

The app has three layouts (`src/lib/layout.svelte.ts`): phone `< 720px`, tablet `720–1179px`, wide desktop `≥ 1180px`. A change that looks right in one layout regularly breaks another, so before calling a UI change done:

- Check it at **phone widths 320, 375 and 412px** (with `isMobile: true, hasTouch: true`) and on **desktop at 1440px**. Check the tablet width (1024px) too if the change touches the top bar, the backlog or the day columns.
- **Look at the screenshots** (read the PNGs). Don't rely on assertions alone.
- **Measure** what screenshots hide: overlapping element boxes in the top bar and in rows, and `document.documentElement.scrollWidth` larger than the viewport (horizontal scroll).
- **Touch:** `:hover` styles stick after a tap on phones, so wrap hover-only styling in `@media (hover: hover)`. Use `page.tap` for touch flows.
- **Sync features** need two browser contexts paired through the local relay (below). Check that the change reaches the other device, not only the device that made it.
- **Things headless Chromium can't show:** native pickers (`showPicker()`), iOS Safari and real-device behaviour. Test the logic around them, and tell the user exactly what is left for them to check on a real phone.

## How to run browser checks

Playwright and the browser are not project dependencies; the scripts in `e2e/` show the patterns.

- Install `playwright-core` in a scratch directory outside the repo, not in `package.json`.
- Use the Chromium from `~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`.

```sh
npx vite build && npx vite preview --port 4180 --strictPort     # normal build

# Build that syncs through the local relay instead of public relays:
node scripts/dev-relay.mjs &                                     # ws://localhost:7777
VITE_DEFAULT_RELAYS=ws://localhost:7777 npx vite build --outDir <tmp>/dist-test
npx vite preview --outDir <tmp>/dist-test --port 4181 --strictPort
```

Stop the preview servers and the relay afterwards. Kill them by PID; `pkill -f` matches the shell running it and kills that too.

Always run `npm run check` and `npm test` as well.

## Commits

- One logical change per commit, with a message that explains why.
- Push to `main` only after the change is verified as above; the GitHub Actions workflow deploys on push.
- Keep README.md, docs/SYNC.md and TODO.md in step with behaviour changes.
