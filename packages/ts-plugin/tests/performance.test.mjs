import assert from 'node:assert';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { buildSzKeyEntries } = require('../dist/completions.js');
const { computeSzEntries } = require('../dist/core.js');

const config = { enabled: true, values: true, maxEntries: 512, deadlineMs: 20, failureThreshold: 3 };

/** Build a module of N filler lines with an sz probe and a non-sz object at the end.
 * @param {number} lines - Filler line count.
 * @returns {string} The source text.
 */
function makeSource(lines) {
    const filler = Array.from(
        { length: lines },
        (_unused, index) => `const value${index} = ${index} + Math.random();`,
    ).join('\n');
    return `${filler}\nconst A = () => <div sz={{  }} />;\nconst B = { plain: 1 };\n`;
}

/** Measure warm completion latency percentiles for one source size.
 * @param {string} source - Fixture source.
 * @returns {{ szP50: number, szP99: number, nonSzP50: number }} Percentiles (ms).
 */
function measure(source) {
    const fileName = '/virtual/performance.tsx';
    const files = { [fileName]: source };
    const host = {
        getScriptFileNames: () => [fileName],
        getScriptVersion: () => '1',
        getScriptSnapshot: file => {
            const content =
                files[file] ?? (ts.sys.fileExists(file) ? ts.sys.readFile(file) : undefined);
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
    const szPosition = source.indexOf('  }}') + 1;
    const nonSzPosition = source.indexOf('plain:') + 'plain:'.length;

    const sample = position => {
        computeSzEntries(ts, service, fileName, position, config, Number.POSITIVE_INFINITY);
        const values = [];
        for (let index = 0; index < 2_000; index += 1) {
            const start = performance.now();
            computeSzEntries(ts, service, fileName, position, config, Number.POSITIVE_INFINITY);
            values.push(performance.now() - start);
        }
        values.sort((left, right) => left - right);
        return values;
    };
    const sz = sample(szPosition);
    const nonSz = sample(nonSzPosition);
    return {
        szP50: sz[Math.floor(sz.length * 0.5)],
        szP99: sz[Math.floor(sz.length * 0.99)],
        nonSzP50: nonSz[Math.floor(nonSz.length * 0.5)],
        service,
        fileName,
        szPosition,
    };
}

const small = measure(makeSource(1_000));
const large = measure(makeSource(10_000));

// Absolute sanity, generous enough to absorb shared-runner noise: a real
// blow-up (a per-request whole-file traversal) would cross this by an order of
// magnitude, not a fraction of a millisecond.
assert.ok(large.szP99 <= 8, `warm completion p99 ${large.szP99.toFixed(3)}ms exceeds 8ms`);

// File-size independence, the property that actually matters: 10x the lines must
// not multiply the median completion cost. Median (not p95) and a relative bound
// keep this stable across CI runners of any speed while still catching an
// O(file-size) regression (which would be ~10x, far past the 4x + 0.5ms bound).
assert.ok(
    large.szP50 <= small.szP50 * 4 + 0.5,
    `completion scales with file size: 1k=${small.szP50.toFixed(3)}ms 10k=${large.szP50.toFixed(3)}ms`,
);

// The non-sz prefilter does strictly less than a full completion at the same
// size, so it must not cost more — a relative invariant, immune to runner speed.
assert.ok(
    large.nonSzP50 <= large.szP50 + 0.5,
    `non-sz prefilter (${large.nonSzP50.toFixed(3)}ms) should not exceed completion (${large.szP50.toFixed(3)}ms)`,
);

// Cancellation and deadline expiry return before any classification work.
assert.deepStrictEqual(
    computeSzEntries(
        ts,
        large.service,
        large.fileName,
        large.szPosition,
        config,
        Number.POSITIVE_INFINITY,
        () => true,
    ),
    [],
    'pre-cancelled work must return before classification',
);
assert.deepStrictEqual(
    computeSzEntries(ts, large.service, large.fileName, large.szPosition, config, -1),
    [],
    'expired work must return before classification',
);
let abortChecks = 0;
const abortedEntries = buildSzKeyEntries(ts, 512, { start: 0, length: 0 }, () => {
    abortChecks += 1;
    return abortChecks > 1;
});
assert.strictEqual(abortedEntries.length, 32, 'entry construction must stop at its next checkpoint');
console.log(
    `performance checks passed (sz p50 1k=${small.szP50.toFixed(3)}ms 10k=${large.szP50.toFixed(3)}ms, p99=${large.szP99.toFixed(3)}ms)`,
);
