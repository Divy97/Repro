import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { SkipGate } from './test/fixtures/skip.js';

// THE SUITE NEVER READS `.env`. That file is the operator's configuration, and in the main
// checkout its `DATABASE_URL` is the production database. While this file loaded it, the
// suite ran there: `test/plane.test.ts` raced the live worker for weeks, a queue drain in a
// test would have stamped every real queued run, and `test/secrets.test.ts` left 37 rows in
// production. A database test gets its database from the environment the command was run
// with, as CI does, and nothing else.
//
// The model selection is scrubbed for the same reason, from wherever it came. When
// `ENGINE_PROVIDER=openrouter` reached the suite, six tests went red: every Anthropic-path
// test went down the OpenRouter branch, where the scripted Messages API fixture is the
// wrong wire format. A test that wants a provider sets it itself; `openrouter.test.ts`
// does, and its "defaults to anthropic" case is a real assertion only because of this.
for (const key of ['ENGINE_PROVIDER', 'ENGINE_MODEL', 'ENGINE_EFFORT', 'OPENROUTER_API_KEY']) {
  delete process.env[key];
}

// And a database somewhere else is refused outright, however it got here. These tests
// queue jobs a live worker claims, terminate backends on purpose, and write rows they do
// not all delete. A shell that exported the production URL is the same mistake as `.env`.
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
if (process.env.DATABASE_URL) {
  const host = new URL(process.env.DATABASE_URL).hostname;
  if (!LOOPBACK.has(host)) {
    throw new Error(
      `DATABASE_URL names ${host}, and this suite runs only against a database on this machine. ` +
        'Start one with `docker run -d -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=events -p 127.0.0.1:55432:5432 postgres:17`, ' +
        'apply the schema with `DATABASE_URL=postgres://postgres:ci@127.0.0.1:55432/events npx tsx src/cli.ts schema --yes`, ' +
        'and run the suite with that DATABASE_URL. Unset it to skip the database tests.',
    );
  }
}

// The engine fixtures shell out to real git and run a repro three times, so the
// slowest tests sit near vitest's 5s default and fail under load. Raise the
// ceiling rather than let a green suite depend on how busy the machine is.
export default defineConfig({
  // The dashboard's screens are `.tsx` since 10i, and `test/screens.test.tsx` renders them
  // with `renderToStaticMarkup`. `automatic` so the components need no React import, which
  // is what `web/tsconfig.json` already compiles them under — two settings that disagree
  // would mean the file the suite checks is not the file the bundle ships.
  esbuild: { jsx: 'automatic' },
  // ONE React, and this is not tidiness. `web/` has its own `node_modules` — deliberately,
  // so Next never enters the worker or the sandbox images — so a component imported from
  // there resolves `react` to `web/node_modules/react` while `react-dom/server` in the test
  // file resolves to the root one. Two copies means two hook dispatchers, and every
  // component that calls `useState` renders as `Cannot read properties of null`.
  resolve: {
    alias: {
      react: fileURLToPath(new URL('./node_modules/react', import.meta.url)),
      'react-dom': fileURLToPath(new URL('./node_modules/react-dom', import.meta.url)),
    },
  },
  test: {
    testTimeout: 30_000,
    // A skip in CI is a check that did not run on a green build. See `test/fixtures/skip.ts`.
    reporters: ['default', new SkipGate()],
    // `.claude/worktrees/*` holds full checkouts of this repository, so the default
    // glob collected every test file TWICE — 18 files where there are 9, and every
    // container test run against a copy of `src` nobody is editing. It doubled the
    // suite's wall clock and, worse, a stale worktree could fail on code that is
    // not the code under change. Excluded rather than deleted: the worktrees are
    // not this suite's to remove.
    // `demo/**` is a REPOSITORY, not part of this suite. Its own tests are a
    // `node --test` suite that the environment recipe runs inside the sandbox —
    // which is the whole point of it — and vitest cannot load them anyway, since
    // vite does not resolve `node:sqlite`. Collecting them here would also mean
    // this engine's suite failing when the demo's deliberate bugs are being worked
    // on, which is exactly backwards.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**', 'demo/**'],
  },
});
