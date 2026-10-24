// The one way a test in this suite declines to run, and the gate that keeps it honest.
//
// A test that lacked its database, its browser, its bundle or Docker used to `return` early,
// and vitest counts that as a PASS. A run with no Docker read "135 passed" (6f3c291), the
// store tests passed with no database (153eda8), and two static checks were
// `expect(true).toBe(true)` until a build existed. `skip()` makes vitest report the test as
// skipped, with the reason on the console. `SkipGate` then fails a CI run on any skip it was
// not told to expect, because CI provides every prerequisite.

import type { Reporter, RunnerTask, RunnerTestFile, TaskContext } from 'vitest';

export function skip(context: TaskContext, why: string): never {
  console.log(`SKIPPED (${context.task.name}): ${why}`);
  context.skip();
  throw new Error('unreachable: context.skip() throws');
}

/** Tests CI cannot run by design, each with the reason. Everything else that skips in CI fails it. */
export const EXPECTED_IN_CI: Record<string, string> = {
  'test/github.test.ts > a real issue on the demo repository produces a real pull request':
    'needs a registered GitHub App, and CI holds no credential',
  'test/sandbox.test.ts > the containment boundary > was NOT verified: no Docker daemon':
    'runs only when Docker is absent, and CI has Docker',
  'test/sandbox.test.ts > the engine runs inside the sandbox > the agent sees the wrong string by looking, and commits a test that needs no browser':
    'needs the agent image, which CI does not build',
};

const skippedTests = (task: RunnerTask, path: string[]): string[] => {
  const name = [...path, task.name];
  if (task.type === 'suite') return task.tasks.flatMap((child) => skippedTests(child, name));
  return task.mode === 'skip' || task.result?.state === 'skip' ? [name.join(' > ')] : [];
};

export class SkipGate implements Reporter {
  onFinished(files: RunnerTestFile[] = []): void {
    if (!process.env.CI) return;
    const unexpected = files
      .flatMap((file) => file.tasks.flatMap((task) => skippedTests(task, [file.name])))
      .filter((name) => !(name in EXPECTED_IN_CI));
    if (unexpected.length === 0) return;
    console.error(
      `\n${unexpected.length} test(s) skipped in CI, where every prerequisite is provided:\n` +
        `${unexpected.map((name) => `  - ${name}`).join('\n')}\n\n` +
        'A skip here is a check that did not run on a green build. Fix the prerequisite in ' +
        '.github/workflows/check.yml, or, if CI cannot provide it by design, add the test to ' +
        'EXPECTED_IN_CI in test/fixtures/skip.ts with the reason.\n',
    );
    process.exitCode = 1;
  }
}
