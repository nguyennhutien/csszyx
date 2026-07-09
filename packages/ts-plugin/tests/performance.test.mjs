import assert from 'node:assert';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { buildSzKeyEntries } = require('../dist/completions.js');
const { computeSzEntries } = require('../dist/core.js');

const fileName = '/virtual/performance.tsx';
// A realistic large module: the sz probe sits at the end so classification runs
// after ~10k lines of unrelated code, guarding against an O(file-size) regression
// (e.g. an accidental whole-file traversal) that a tiny fixture could not catch.
const filler = Array.from(
    { length: 10_000 },
    (_unused, index) => `const value${index} = ${index} + Math.random();`,
).join('\n');
const source = `${filler}\nconst A = () => <div sz={{  }} />;\nconst B = { plain: ${1} };\n`;
const position = source.indexOf('  }}') + 1;
const nonSzPosition = source.indexOf('plain:') + 'plain:'.length;
const files = { [fileName]: source };
const host = {
    getScriptFileNames: () => [fileName],
    getScriptVersion: () => '1',
    getScriptSnapshot: file => {
        const content = files[file] ?? (ts.sys.fileExists(file) ? ts.sys.readFile(file) : undefined);
        return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => '/virtual',
    getCompilationSettings: () => ({ jsx: ts.JsxEmit.ReactJSX }),
    getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
    fileExists: file => file in files || ts.sys.fileExists(file),
    readFile: file => files[file] ?? ts.sys.readFile(file),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
};
const service = ts.createLanguageService(host);
const config = {
    enabled: true,
    values: true,
    maxEntries: 512,
    deadlineMs: 20,
    failureThreshold: 3,
};

computeSzEntries(ts, service, fileName, position, config, Number.POSITIVE_INFINITY);
const samples = [];
for (let index = 0; index < 2_000; index += 1) {
    const start = performance.now();
    computeSzEntries(ts, service, fileName, position, config, Number.POSITIVE_INFINITY);
    samples.push(performance.now() - start);
}
samples.sort((left, right) => left - right);
const percentile = value => samples[Math.floor(samples.length * value)];
const p95 = percentile(0.95);
const p99 = percentile(0.99);
assert.ok(p95 <= 3, `warm completion p95 ${p95.toFixed(3)}ms exceeds 3ms`);
assert.ok(p99 <= 8, `warm completion p99 ${p99.toFixed(3)}ms exceeds 8ms`);

// The 99% case: the cursor is NOT in an sz context, so the prefilter must reject
// it far below the completion budget even in a large file.
const nonSzSamples = [];
for (let index = 0; index < 2_000; index += 1) {
    const start = performance.now();
    computeSzEntries(ts, service, fileName, nonSzPosition, config, Number.POSITIVE_INFINITY);
    nonSzSamples.push(performance.now() - start);
}
nonSzSamples.sort((left, right) => left - right);
const nonSzP95 = nonSzSamples[Math.floor(nonSzSamples.length * 0.95)];
assert.ok(nonSzP95 <= 1, `non-sz prefilter p95 ${nonSzP95.toFixed(3)}ms exceeds 1ms`);
assert.deepStrictEqual(
    computeSzEntries(ts, service, fileName, position, config, Number.POSITIVE_INFINITY, () => true),
    [],
    'pre-cancelled work must return before classification',
);
assert.deepStrictEqual(
    computeSzEntries(ts, service, fileName, position, config, -1),
    [],
    'expired work must return before classification',
);
let abortChecks = 0;
const abortedEntries = buildSzKeyEntries(ts, 512, { start: 0, length: 0 }, () => {
    abortChecks += 1;
    return abortChecks > 1;
});
assert.strictEqual(abortedEntries.length, 32, 'entry construction must stop at its next checkpoint');
console.log(`performance checks passed (p95=${p95.toFixed(3)}ms, p99=${p99.toFixed(3)}ms)`);
