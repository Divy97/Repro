import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MUTATE = fileURLToPath(new URL('../scripts/mutate.mts', import.meta.url));
const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));

const COMMITTED = 'export const checkKey = () => true;\n';
const UNCOMMITTED_FIX = 'export const checkKey = (key: string) => probe(key);\n';

/** A committed file with a finished, uncommitted fix on top: the state work was lost from. */
const withUncommittedFix = () => {
  const root = mkdtempSync(join(tmpdir(), 'mutate-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  git('init', '-q');
  const file = join(root, 'routes.ts');
  writeFileSync(file, COMMITTED);
  git('add', 'routes.ts');
  git('commit', '-q', '-m', 'base');
  writeFileSync(file, UNCOMMITTED_FIX);
  return { root, file, git };
};

const mutate = (file: string, ...command: string[]) =>
  spawnSync(TSX, [MUTATE, file, 'probe(key)', 'true', '--', ...command], { encoding: 'utf8' });

describe('scripts/mutate.mts puts back the bytes the file had, committed or not', () => {
  it('reports a caught mutation and keeps the uncommitted fix', () => {
    const { file } = withUncommittedFix();
    const result = mutate(file, 'grep', '-q', 'probe(key)', file);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('RED');
    expect(readFileSync(file, 'utf8')).toBe(UNCOMMITTED_FIX);
  });

  it('reports a mutation nothing caught, and still keeps the fix', () => {
    const { file } = withUncommittedFix();
    const result = mutate(file, 'true');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('GREEN');
    expect(readFileSync(file, 'utf8')).toBe(UNCOMMITTED_FIX);
  });

  it('where `git checkout --`, the revert it replaces, loses the fix', () => {
    const { file, git } = withUncommittedFix();
    writeFileSync(file, UNCOMMITTED_FIX.replace('probe(key)', 'true'));
    git('checkout', '--', 'routes.ts');
    expect(readFileSync(file, 'utf8')).toBe(COMMITTED);
  });
});
