// Driver: answers every case with run() and writes /output/answers.json,
// stringifying one case at a time and streaming it to the file so the
// whole 12 MB answers array + 12 MB string never coexist (lower peak
// memory, less GC). Byte-identical to JSON.stringify of the full array.
import { readFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking --max-semi-space-size=256 --single-generation');

const { run } = await import(new URL('./solve.js', import.meta.url).href);

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json')));
const fd = openSync(join(outputDir, 'answers.json'), 'w');
writeSync(fd, '[');
for (let i = 0; i < cases.length; i++) {
  if (i > 0) writeSync(fd, ',');
  writeSync(fd, JSON.stringify(run(cases[i].input)));
  cases[i] = null; // free this case's text once its slices are dead
}
writeSync(fd, ']');
closeSync(fd);
