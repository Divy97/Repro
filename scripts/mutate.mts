// A mutation control that cannot lose work.
//
//   npx tsx scripts/mutate.mts <file> <find> <replace> -- <command...>
//
// Replaces the one occurrence of <find> in <file>, runs <command>, and puts back the bytes the
// file had before, committed or not. `git checkout -- <file>` puts back HEAD instead, and in
// this repository that deleted uncommitted fixes four times.
//
// Exits 0 when the command failed (the mutation was caught) and 1 when it passed.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const [file, find, replace, separator, ...command] = process.argv.slice(2);
if (!file || find === undefined || replace === undefined || separator !== '--' || command.length === 0) {
  console.error('usage: npx tsx scripts/mutate.mts <file> <find> <replace> -- <command...>');
  process.exit(64);
}

const original = readFileSync(file);
const text = original.toString('utf8');
const hits = text.split(find).length - 1;
if (hits !== 1) {
  console.error(`mutate: <find> occurs ${hits} times in ${file}; it must occur exactly once`);
  process.exit(64);
}

const restore = () => writeFileSync(file, original);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    restore();
    process.exit(130);
  });
}

writeFileSync(file, text.replace(find, () => replace));
let status: number | null;
try {
  status = spawnSync(command[0]!, command.slice(1), { stdio: 'inherit' }).status;
} finally {
  restore();
}
if (!readFileSync(file).equals(original)) {
  console.error(`mutate: ${file} does not match its bytes before the mutation. Something else wrote it during the run.`);
  process.exit(70);
}

if (status === 0) {
  console.error(`mutate: GREEN. Nothing caught the mutation in ${file}.`);
  process.exit(1);
}
console.error(`mutate: RED (exit ${status}). The mutation was caught, and ${file} is back to its bytes before it.`);
