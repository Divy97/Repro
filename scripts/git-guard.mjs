// A Claude Code PreToolUse hook on Bash (wired in `.claude/settings.json`). It refuses git
// commands that have cost this repository work, and says what to run instead.
//
// Reads the hook's JSON on stdin. Exit 2 blocks the command and shows stderr to the agent.

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/** Drop heredoc bodies, so a commit message that mentions a command is not that command. */
const withoutHeredocs = (command) => {
  const kept = [];
  let delimiter = null;
  for (const line of command.split('\n')) {
    if (delimiter !== null) {
      if (line.trim() === delimiter) delimiter = null;
      continue;
    }
    kept.push(line);
    delimiter = line.match(/<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/)?.[1] ?? null;
  }
  return kept.join('\n');
};

/** Shell words, quote-aware, split into simple commands at `;`, `&&`, `||`, `|` and newlines. */
export function simpleCommands(command) {
  const commands = [[]];
  let word = null;
  let quote = null;
  const text = withoutHeredocs(command);
  const end = () => {
    if (word !== null) commands.at(-1).push(word);
    word = null;
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"') word = (word ?? '') + text[(i += 1)];
      else word = (word ?? '') + char;
    } else if (char === "'" || char === '"') {
      quote = char;
      word ??= '';
    } else if (char === '\\') word = (word ?? '') + text[(i += 1)];
    else if (/\s/.test(char) && char !== '\n') end();
    else if (char === '\n' || char === ';' || char === '|' || (char === '&' && text[i + 1] === '&')) {
      end();
      if (char === '&' || (char === '|' && text[i + 1] === '|')) i += 1;
      commands.push([]);
    } else word = (word ?? '') + char;
  }
  end();
  return commands.filter((words) => words.length > 0);
}

/** `git [-C dir] [-c k=v] <sub> ...args` → { dir, sub, args }, or null. */
const gitInvocation = (words) => {
  const at = words.indexOf('git');
  if (at === -1) return null;
  let dir = null;
  let i = at + 1;
  while (words[i] === '-C' || words[i] === '-c') {
    if (words[i] === '-C') dir = words[i + 1];
    i += 2;
  }
  return words[i] ? { dir, sub: words[i], args: words.slice(i + 1) } : null;
};

const BLIND_ADD = new Set(['-A', '--all', '-u', '--update', '.', './', ':/', '*']);
const TAKES_VALUE = new Set(['-m', '-F', '-C', '-c', '-t', '--message', '--file', '--author', '--date', '--template']);

/** Why `git add -A` / `git commit -a` is refused, or null. */
export function blindStaging(command) {
  for (const words of simpleCommands(command)) {
    const git = gitInvocation(words);
    if (!git) continue;
    if (git.sub === 'add' && git.args.some((arg) => BLIND_ADD.has(arg))) return `\`git add ${git.args.join(' ')}\``;
    if (git.sub === 'commit') {
      for (let i = 0; i < git.args.length; i += 1) {
        const arg = git.args[i];
        if (TAKES_VALUE.has(arg)) i += 1;
        else if (arg === '--all' || /^-[A-Za-z]*a[A-Za-z]*$/.test(arg)) return `\`git commit ${arg}\``;
      }
    }
  }
  return null;
}

/**
 * The git commands that overwrite the working tree from HEAD or the index, each with the
 * directory it runs in and the paths it overwrites. `cd <dir>` earlier in the line moves it.
 */
export function discards(command, cwd) {
  const found = [];
  let here = cwd;
  for (const words of simpleCommands(command)) {
    if (words[0] === 'cd' && words[1]) here = resolve(here, words[1]);
    const git = gitInvocation(words);
    if (!git) continue;
    const dir = git.dir ? resolve(here, git.dir) : here;
    const dashes = git.args.indexOf('--');
    if (git.sub === 'checkout' && dashes !== -1) found.push({ dir, command: `git checkout ${git.args.join(' ')}`, paths: git.args.slice(dashes + 1) });
    else if (git.sub === 'checkout' && git.args.includes('.')) found.push({ dir, command: 'git checkout .', paths: ['.'] });
    else if (git.sub === 'reset' && git.args.includes('--hard')) found.push({ dir, command: `git reset ${git.args.join(' ')}`, paths: ['.'] });
    else if (git.sub === 'restore') {
      const staged = git.args.includes('--staged') || git.args.includes('-S');
      const worktree = git.args.includes('--worktree') || git.args.includes('-W');
      if (staged && !worktree) continue;
      const paths = [];
      for (let i = 0; i < git.args.length; i += 1) {
        const arg = git.args[i];
        if (arg === '--source' || arg === '-s') i += 1;
        else if (arg === '--' || arg.startsWith('-')) continue;
        else paths.push(arg);
      }
      found.push({ dir, command: `git restore ${git.args.join(' ')}`, paths });
    }
  }
  return found.filter((one) => one.paths.length > 0);
}

// This hook runs before the human approves the command, on a directory the command names.
// Git executes a repository's own config (an fsmonitor, an external diff, a textconv driver)
// while it reads that repository, so every call here switches those off.
const SAFE = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'diff.external=', '--no-pager'];
const git = (dir, ...args) =>
  execFileSync('git', [...SAFE, '-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const real = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** The repository a directory belongs to, or null when it belongs to none. */
export function toplevel(dir) {
  try {
    return real(git(dir, 'rev-parse', '--show-toplevel'));
  } catch {
    return null;
  }
}

/** Whether a repository sits inside the project this session was started in. */
export const inside = (repository, root) => repository === root || repository.startsWith(`${root}${sep}`);

/** `git diff --stat` of the uncommitted edits a discard would destroy, or '' when there are none. */
export function uncommitted({ dir, paths }) {
  try {
    return git(dir, 'diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--stat', '--', ...paths);
  } catch {
    return '';
  }
}

const refuse = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const command = input?.tool_input?.command;
  if (typeof command !== 'string') process.exit(0);

  const blind = blindStaging(command);
  if (blind) {
    refuse(
      `Refused: ${blind} stages everything in the tree, including what another agent or a mutation ` +
        'control left there. In this repository it once committed and pushed a reviewer\'s removed ' +
        'security guard. Stage explicit paths (`git add src/x.ts test/x.test.ts`), then read ' +
        '`git diff --cached` before you commit.',
    );
  }

  const cwd = input.cwd ?? process.cwd();
  // Only Claude Code's own variable. The hook input's cwd moves wherever a command went, so a
  // root taken from it is a root the command chose.
  const root = process.env.CLAUDE_PROJECT_DIR ? real(process.env.CLAUDE_PROJECT_DIR) : null;
  for (const discard of discards(command, cwd)) {
    if (root === null) {
      refuse(
        `Refused: \`${discard.command}\` can discard uncommitted work, and this hook cannot tell which ` +
          'repositories it may inspect: CLAUDE_PROJECT_DIR is not set, so the project root is unknown. ' +
          'Run it from a Claude Code session started in the project, or ask the human to run it.',
      );
    }
    const repository = toplevel(discard.dir);
    if (repository === null) continue;
    if (!inside(repository, root)) {
      refuse(
        `Refused: \`${discard.command}\` targets ${repository}, which is outside this project (${root}). ` +
          'This hook checks for uncommitted work before a discard, and it will not read a repository it ' +
          'does not trust: git runs a repository\'s own config while it reads it. Run the command from ' +
          'inside the project, or ask the human to run it.',
      );
    }
    const stat = uncommitted(discard);
    if (!stat) continue;
    refuse(
      `Refused: \`${discard.command}\` would overwrite these uncommitted edits:\n\n${stat}\n\n` +
        'It restores HEAD or the index, not the state before your last edit, and in this repository it ' +
        'has deleted finished, uncommitted fixes four times while reverting a mutation control.\n' +
        '- Edits you want to keep: commit them.\n' +
        '- For a mutation control, run `npx tsx scripts/mutate.mts <file> <find> <replace> -- <test command>`. ' +
        'It puts back the bytes the file had, committed or not.\n' +
        '- To set edits aside on purpose, `git stash push -m "<unique tag>" -- <paths>` keeps them recoverable.',
    );
  }
}
