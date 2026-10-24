// A Claude Code PreToolUse hook on Bash (wired in `.claude/settings.json`). It refuses git
// commands that have cost this repository work, and says what to run instead.
//
// Reads the hook's JSON on stdin. Exit 2 blocks the command and shows stderr to the agent.

import { readFileSync } from 'node:fs';

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
}
