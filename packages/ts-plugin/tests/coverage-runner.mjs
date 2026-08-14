// Coverage entry point: run each unit test file as its own child process so
// c8's NODE_V8_COVERAGE propagates and the per-file `dist/*.js` coverage from
// every test aggregates into one report. `node a.mjs b.mjs` would run only the
// first file (the rest become argv), which is why coverage must fan out here.
//
// The pure-logic tests exercise the granular dist modules that map back to
// src/*.ts; pack/tsserver are correctness-only (they load the shipped bundle and
// a packed tarball, not the per-file build) so they add no src coverage and run
// in the `test` script instead.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const suites = ['spike', 'contract', 'theme-values', 'proxy', 'performance'];

for (const suite of suites) {
    const nodeArgs = suite === 'performance' ? ['--expose-gc'] : [];
    execFileSync(process.execPath, [...nodeArgs, join(here, `${suite}.test.mjs`)], {
        stdio: 'inherit',
    });
}
