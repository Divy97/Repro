import { describe, expect, it } from 'vitest';
import { blindCasts } from '../scripts/check-casts.mjs';

describe('scripts/check-casts.mts finds the casts that hid a mismatch', () => {
  it('finds each shape that once switched the compiler off', () => {
    const found = blindCasts(
      'x.ts',
      [
        `await execFileAsync('runner', [], { input: job } as never);`,
        `const sdk = module as unknown as Sdk;`,
        `const io = { findings, append: async () => {} } as DaemonIo & { findings: unknown[] };`,
        `const loose = value as any;`,
      ].join('\n'),
    );
    expect(found).toEqual([
      'x.ts:1 `as never`',
      'x.ts:2 `as unknown as`',
      'x.ts:3 an object literal cast with `as`',
      'x.ts:4 `as any`',
    ]);
  });

  it('leaves alone what the compiler still checks', () => {
    const found = blindCasts(
      'x.ts',
      [
        `const EXIT = { complete: 0 } as const;`,
        `const io: DaemonIo = { findings };`,
        `const typed = { findings } satisfies DaemonIo;`,
        `const narrowed = value as string;`,
      ].join('\n'),
    );
    expect(found).toEqual([]);
  });

  it('honours an exception until it expires', () => {
    const text = [`// cast-allowed: the SDK ships no types, expires 2026-12-31, approved by divy`, `const sdk = module as unknown as Sdk;`].join('\n');
    expect(blindCasts('x.ts', text, '2026-10-24')).toEqual([]);
    expect(blindCasts('x.ts', text, '2027-01-01')).toEqual(['x.ts:2 `as unknown as`']);
  });
});
