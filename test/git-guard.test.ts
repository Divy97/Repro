import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const GUARD = fileURLToPath(new URL('../scripts/git-guard.mjs', import.meta.url));

/** Runs the hook the way Claude Code does: the tool call as JSON on stdin. */
const hook = (command: string, cwd = process.cwd()) => {
  const result = spawnSync('node', [GUARD], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd, tool_input: { command } }),
    encoding: 'utf8',
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

/** A repository whose `src/routes.ts` is committed, as on 2026-09-09. */
const repository = () => {
  const root = mkdtempSync(join(tmpdir(), 'git-guard-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' });
  git('init', '-q');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/routes.ts'), 'export const checkKey = () => true;\n');
  writeFileSync(join(root, 'src/other.ts'), 'export const other = 1;\n');
  git('add', 'src/routes.ts', 'src/other.ts');
  git('commit', '-q', '-m', 'base');
  return { root, file: join(root, 'src/routes.ts') };
};

describe('the git guard refuses a checkout that would delete uncommitted work', () => {
  it('refuses the revert that deleted the checkKey seam while it was uncommitted', () => {
    const { root, file } = repository();
    writeFileSync(file, 'export const checkKey = (key: string) => probe(key);\n// the fix, not yet committed\n');
    const { blocked, stderr } = hook('git checkout -- src/routes.ts', root);
    expect(blocked).toBe(true);
    expect(stderr).toContain('src/routes.ts');
    expect(stderr).toContain('scripts/mutate.mts');
  });

  it.each(['git checkout HEAD -- src', 'git checkout .', 'git restore src/routes.ts', 'git reset --hard', 'cd src && git checkout -- routes.ts'])(
    'refuses %s over the same edits',
    (command) => {
      const { root, file } = repository();
      writeFileSync(file, 'export const checkKey = (key: string) => probe(key);\n');
      expect(hook(command, root).blocked).toBe(true);
    },
  );

  it('allows a checkout of a file with nothing uncommitted in it', () => {
    const { root, file } = repository();
    writeFileSync(file, 'export const checkKey = (key: string) => probe(key);\n');
    expect(hook('git checkout -- src/other.ts', root).blocked).toBe(false);
    expect(hook('git restore --staged src/routes.ts', root).blocked).toBe(false);
  });
});
