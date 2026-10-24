import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
