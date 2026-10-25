import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = new URL('./', import.meta.url);
const files = readdirSync(DIR).filter((name) => /\.test\.tsx?$/.test(name));

/**
 * A test body that opens by returning when something is missing. Vitest counts it as a pass,
 * which is how a run with no Docker, no database or no browser has read as green here.
 */
const SILENT = /\b(?:test|it)(?:\.\w+)*\([^\n]*=> \{\n\s*if \([^\n]*\)\s*(?:return(?: void [^\n]*)?;|\{\n(?:\s*\/\/[^\n]*\n|\s*console\.log\([^\n]*\);\n)*\s*return;\n\s*\})/g;

export const silentSkips = (name: string, text: string): string[] =>
  [...text.matchAll(SILENT)].map((match) => `${name}:${text.slice(0, match.index).split('\n').length}`);

describe('a test that cannot run says so', () => {
  it('no test returns early, which vitest would count as a pass', () => {
    const found = files.flatMap((name) => silentSkips(name, readFileSync(new URL(name, DIR), 'utf8')));
    expect(found, 'use `return skip(context, why)` from test/fixtures/skip.ts, so the test is reported as skipped').toEqual([]);
  });

  it('and the pattern finds the shapes that used to do it', () => {
    expect(silentSkips('x', "  it('a', async () => {\n    if (!client) return void console.log(`SKIPPED: ${why}`);\n")).toEqual(['x:1']);
    expect(silentSkips('x', "  test('a', async () => {\n    if (!client) {\n      // why\n      console.log(`SKIPPED: ${why}`);\n      return;\n    }\n")).toEqual(['x:1']);
    expect(silentSkips('x', "  test('a', () => {\n    if (!haveDocker) return;\n")).toEqual(['x:1']);
    expect(silentSkips('x', "  test('a', async (context) => {\n    if (!client) return skip(context, why);\n")).toEqual([]);
  });
});
