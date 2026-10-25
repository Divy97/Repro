// Fails when a change adds a type assertion that switches the compiler off.
//
// Three times a cast hid a fake or a call that did not match the real thing, and the
// typecheck stayed clean each time:
//   - 0ecb15e: `as never` let `execFileAsync(..., { input })` compile. `input` does nothing
//     there, so the Job never reached stdin and the test hung for 600s.
//   - b1bbf2d: `as unknown as Sdk` hid that `sandboxId` does not exist, so `sweep()` never
//     stopped a sandbox.
//   - 2ced80a: `{ ... } as DaemonIo & { findings: unknown[] }` let every fake in
//     `test/kinds.test.ts` lack `io.note`, which the code under test then called.
//
// The pattern is common, so this is a ratchet: `scripts/casts.json` holds today's count per
// file, a file may not go above it, and a file that goes below it lowers its number.
// `--write` only ever lowers. A new cast that must stay carries, on its line or the one
// above, `// cast-allowed: <reason>, expires YYYY-MM-DD, approved by <human>`.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const ROOT = new URL('..', import.meta.url).pathname;
const BASELINE = join(ROOT, 'scripts/casts.json');
const DIRS = ['src', 'test', 'scripts', '.claude/skills/verify-repro/scripts', 'web/app', 'web/components', 'web/lib'];
const SOURCE = /\.(ts|tsx|mts)$/;

const files = (dir: string): string[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : files(path);
    return SOURCE.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
  });

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;

const EXCEPTION = /cast-allowed: .+, expires (\d{4}-\d{2}-\d{2}), approved by \S+/;

/** The assertions that stop the compiler comparing two shapes, minus unexpired exceptions. */
export function blindCasts(path: string, text: string, today = new Date().toISOString().slice(0, 10)): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = text.split('\n');
  const excepted = (line: number): boolean =>
    [lines[line - 1], lines[line - 2]].some((candidate) => {
      const expiry = candidate?.match(EXCEPTION)?.[1];
      return expiry !== undefined && expiry >= today;
    });
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      const inner = unwrap(node.expression);
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      if (excepted(line)) return ts.forEachChild(node, visit);
      if (node.type.kind === ts.SyntaxKind.NeverKeyword) found.push(`${path}:${line} \`as never\``);
      else if (node.type.kind === ts.SyntaxKind.AnyKeyword) found.push(`${path}:${line} \`as any\``);
      else if ((ts.isAsExpression(inner) || ts.isTypeAssertionExpression(inner)) && inner.type.kind === ts.SyntaxKind.UnknownKeyword) {
        found.push(`${path}:${line} \`as unknown as\``);
      } else if (
        ts.isObjectLiteralExpression(inner) &&
        !ts.isConstTypeReference(node.type) &&
        node.type.kind !== ts.SyntaxKind.UnknownKeyword
      ) {
        found.push(`${path}:${line} an object literal cast with \`as\``);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

export const count = (): Record<string, string[]> =>
  Object.fromEntries(
    DIRS.flatMap(files)
      .map((path) => [path, blindCasts(path, readFileSync(join(ROOT, path), 'utf8'))] as const)
      .filter(([, casts]) => casts.length > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

if (import.meta.url === `file://${process.argv[1]}`) {
  const now = count();
  const allowed: Record<string, number> = JSON.parse(readFileSync(BASELINE, 'utf8'));
  if (process.argv.includes('--write')) {
    const lowered = Object.entries(allowed)
      .map(([file, limit]) => [file, Math.min(limit, now[file]?.length ?? 0)] as const)
      .filter(([, limit]) => limit > 0);
    writeFileSync(BASELINE, `${JSON.stringify(Object.fromEntries(lowered), null, 2)}\n`);
    process.exit(0);
  }
  const over: string[] = [];
  const under: string[] = [];
  for (const file of new Set([...Object.keys(now), ...Object.keys(allowed)])) {
    const casts = now[file] ?? [];
    const limit = allowed[file] ?? 0;
    if (casts.length > limit) over.push(`${file}: ${casts.length} blind casts, ${limit} allowed\n${casts.map((cast) => `    ${cast}`).join('\n')}`);
    if (casts.length < limit) under.push(`${file}: ${casts.length}, baseline says ${limit}`);
  }
  if (over.length > 0) {
    console.error(
      `A cast that switches the compiler off was added:\n\n${over.join('\n')}\n\n` +
        'Type the value instead, so a missing or misnamed member is a compile error: ' +
        '`const io: DaemonIo = { ... }`, `{ ... } satisfies DaemonIo`, or an `import type` of the real SDK type. ' +
        'Casts like these have hidden a hung test, a sweep that never stopped a sandbox, and a fake missing a method.',
    );
    process.exit(1);
  }
  if (under.length > 0) {
    console.error(`Fewer blind casts than scripts/casts.json allows. Lower the baseline with \`npx tsx scripts/check-casts.mts --write\`:\n\n${under.join('\n')}`);
    process.exit(1);
  }
}
