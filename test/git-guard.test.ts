import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const GUARD = fileURLToPath(new URL('../scripts/git-guard.mjs', import.meta.url));

/** Runs the hook the way Claude Code does: the tool call as JSON on stdin. */
const hook = (command: string, cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env) => {
  const result = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd, tool_input: { command } }),
    encoding: 'utf8',
    env,
  });
  return { blocked: result.status === 2, status: result.status, stderr: result.stderr };
};

describe('the git guard runs on every Bash call an agent makes here', () => {
  it('is wired as a PreToolUse hook in the committed settings', () => {
    const settings = JSON.parse(readFileSync(new URL('../.claude/settings.json', import.meta.url), 'utf8'));
    const commands = (settings.hooks?.PreToolUse ?? [])
      .filter((group: { matcher?: string }) => group.matcher === 'Bash')
      .flatMap((group: { hooks: { command: string }[] }) => group.hooks.map((one) => one.command));
    expect(commands).toContain('node "$CLAUDE_PROJECT_DIR/scripts/git-guard.mjs"');
  });
});

describe('the git guard refuses blind staging', () => {
  it('refuses the command that committed a reviewer\'s mutation on PR #9', () => {
    const { blocked, stderr } = hook('git add -A && git commit -m "fix(core): close the findings"');
    expect(blocked).toBe(true);
    expect(stderr).toContain('git add src/x.ts');
  });

  it.each([
    'git add .',
    'git add --all',
    'git -C /tmp/repo add -u',
    'git commit -am "wip"',
    'git commit -m "wip" -a',
    'cd /tmp && git add -A',
  ])('refuses %s', (command) => {
    expect(hook(command).blocked).toBe(true);
  });

  it.each([
    'git add src/verify.ts test/verify.test.ts && git commit -m "never git add -A here"',
    "git commit -F - <<'EOF'\nchore: refuse git add -A\n\ngit add -A committed a mutation once.\nEOF",
    'echo "git add -A"',
    'git commit --amend --no-edit',
    'git status --short',
  ])('allows %s', (command) => {
    const result = hook(command);
    expect(result).toEqual({ blocked: false, status: 0, stderr: '' });
  });
});

describe('the git guard refuses a command that overwrites working-tree files', () => {
  it('refuses the revert that deleted the uncommitted checkKey seam on 2026-09-09', () => {
    const { blocked, stderr } = hook('git checkout -- src/routes.ts');
    expect(blocked).toBe(true);
    expect(stderr).toContain('scripts/mutate.mts');
  });

  it.each([
    'git checkout HEAD -- src',
    'git checkout .',
    'git restore src/routes.ts',
    'git restore --staged --worktree src/routes.ts',
    'git reset --hard',
    'git fetch && git reset --hard origin/main',
    'cd src && git checkout -- routes.ts',
  ])('refuses %s', (command) => {
    expect(hook(command).blocked).toBe(true);
  });

  it.each([
    'git restore --staged src/routes.ts',
    'git checkout main',
    'git switch -C feature origin/feature',
    'git stash push -m "mutation-a01f" -- src/routes.ts',
    'git reset --soft HEAD~1',
  ])('allows %s, which keeps working-tree edits', (command) => {
    expect(hook(command)).toEqual({ blocked: false, status: 0, stderr: '' });
  });
});

/** A script that leaves a marker when something runs it. */
const tripwire = (dir: string, marker: string) => {
  const script = join(dir, `tripwire-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\ncat\n`);
  chmodSync(script, 0o755);
  return script;
};

/** A committed file `f` with an uncommitted edit on top. */
const repository = (root: string) => {
  mkdirSync(root, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  git('init', '-q');
  writeFileSync(join(root, 'f'), 'a\n');
  git('add', 'f');
  git('commit', '-q', '-m', 'base');
  writeFileSync(join(root, 'f'), 'b\n');
  return git;
};

describe('the git guard runs none of a target repository\'s code, because it runs no git', () => {
  it('a clean filter in a repository inside the project', () => {
    const project = mkdtempSync(join(tmpdir(), 'project-'));
    const root = join(project, 'repo');
    const git = repository(root);
    const marker = join(project, 'MARKER');
    writeFileSync(join(root, '.gitattributes'), 'f filter=trip\n');
    git('config', 'filter.trip.clean', tripwire(project, marker));

    git('diff', 'HEAD', '--stat');
    expect(existsSync(marker), 'the control: reading this repository runs its filter').toBe(true);
    rmSync(marker);

    expect(hook(`git -C ${root} checkout -- f`, project, { ...process.env, CLAUDE_PROJECT_DIR: project }).blocked).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  it('a clean filter in a repository nested inside one of the project', () => {
    const project = mkdtempSync(join(tmpdir(), 'project-'));
    repository(project);
    const nested = join(project, 'vendor', 'nested');
    const git = repository(nested);
    const marker = join(project, 'MARKER');
    writeFileSync(join(nested, '.gitattributes'), 'f filter=trip\n');
    git('config', 'filter.trip.clean', tripwire(project, marker));

    git('diff', 'HEAD', '--stat');
    expect(existsSync(marker), 'the control: reading this repository runs its filter').toBe(true);
    rmSync(marker);

    expect(hook('cd vendor/nested && git checkout -- f', project, { ...process.env, CLAUDE_PROJECT_DIR: project }).blocked).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  it('a core.worktree that points the repository at another directory', () => {
    const project = mkdtempSync(join(tmpdir(), 'project-'));
    const elsewhere = join(project, 'elsewhere');
    mkdirSync(elsewhere);
    const root = join(project, 'redirected');
    const git = repository(root);
    const marker = join(project, 'MARKER');
    writeFileSync(join(elsewhere, 'f'), 'c\n');
    writeFileSync(join(elsewhere, '.gitattributes'), 'f filter=trip\n');
    git('config', 'filter.trip.clean', tripwire(project, marker));
    git('config', 'core.worktree', elsewhere);

    git('diff', 'HEAD', '--stat');
    expect(existsSync(marker), 'the control: reading this repository runs the filter in the other directory').toBe(true);
    rmSync(marker);

    expect(hook(`git -C ${root} checkout -- f`, project, { ...process.env, CLAUDE_PROJECT_DIR: project }).blocked).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  it('and no git binary is started at all, whatever the command names', () => {
    const bin = mkdtempSync(join(tmpdir(), 'bin-'));
    const marker = join(bin, 'MARKER');
    writeFileSync(join(bin, 'git'), `#!/bin/sh\ntouch '${marker}'\n`);
    chmodSync(join(bin, 'git'), 0o755);
    const env = { ...process.env, PATH: bin };
    for (const command of ['git checkout -- f', 'git reset --hard', 'git add -A', 'git status']) hook(command, process.cwd(), env);
    expect(existsSync(marker)).toBe(false);
    execFileSync(join(bin, 'git'));
    expect(existsSync(marker), 'the control: this git leaves a marker when started').toBe(true);
  });
});
