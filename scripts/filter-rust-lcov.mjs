import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUMMARY_PREFIXES = ['FNF:', 'FNH:', 'LF:', 'LH:', 'BRF:', 'BRH:'];
const WASM_ONLY_START = '// coverage:wasm-only:start';
const WASM_ONLY_END = '// coverage:wasm-only:end';

function testModuleStart(source) {
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].trim() !== 'mod tests {') continue;
        let previous = index - 1;
        while (previous >= 0 && lines[previous].trim() === '') previous -= 1;
        if (previous >= 0 && lines[previous].trim() === '#[cfg(test)]') return previous + 1;
    }
    return undefined;
}

function lineNumber(record) {
    return Number(record.slice(record.indexOf(':') + 1).split(',', 1)[0]);
}

function wasmOnlyRanges(source) {
    const ranges = [];
    let start;
    for (const [index, line] of source.split(/\r?\n/).entries()) {
        if (line.trim() === WASM_ONLY_START) {
            if (start !== undefined) return [];
            start = index + 1;
        } else if (line.trim() === WASM_ONLY_END) {
            if (start === undefined) return [];
            ranges.push([start, index + 1]);
            start = undefined;
        }
    }
    return start === undefined ? ranges : [];
}

function summary(prefix, total, hit) {
    return [`${prefix}F:${total}`, `${prefix}H:${hit}`];
}

/**
 * Read a source file the report claims coverage for, naming the real cause
 * when it is not there.
 *
 * A report can only cover a file that does not exist if it was produced
 * somewhere else. The repository is mounted at a different path inside the
 * devcontainer, and `target/` is the SAME directory on disk for both, so
 * object files built in one environment stay behind and llvm-cov folds them
 * into the next run's report. A bare ENOENT sends the reader looking at this
 * script instead of at the stale build tree.
 */
function readCoveredSource(sourceFile, readSource) {
    try {
        return readSource(sourceFile);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        throw new Error(
            `the coverage report covers ${sourceFile}, which does not exist. The report was ` +
                'built somewhere else — most likely target/llvm-cov-target still holds objects ' +
                'from a run in the other environment, host versus devcontainer, since both share ' +
                'that directory. Remove target/llvm-cov-target and re-run the coverage gate.',
            { cause: error },
        );
    }
}

function filterRecord(record, readSource) {
    const sourceFile = record.find(line => line.startsWith('SF:'))?.slice(3);
    if (!sourceFile?.includes('/packages/core/src/')) return [...record, 'end_of_record'];

    const source = readCoveredSource(sourceFile, readSource);
    const cutoff = testModuleStart(source);
    const wasmRanges = wasmOnlyRanges(source);
    if (cutoff === undefined && wasmRanges.length === 0) return [...record, 'end_of_record'];

    const isExcludedLine = line =>
        (cutoff !== undefined && line >= cutoff) ||
        wasmRanges.some(([start, end]) => line >= start && line <= end);

    const removedFunctions = new Set(
        record
            .filter(line => line.startsWith('FN:') && isExcludedLine(lineNumber(line)))
            .map(line => line.slice(line.lastIndexOf(',') + 1)),
    );
    const kept = record.filter(line => {
        if (SUMMARY_PREFIXES.some(prefix => line.startsWith(prefix))) return false;
        if (line.startsWith('FN:')) return !isExcludedLine(lineNumber(line));
        if (line.startsWith('FNDA:')) {
            return !removedFunctions.has(line.slice(line.indexOf(',') + 1));
        }
        if (line.startsWith('DA:') || line.startsWith('BRDA:')) {
            return !isExcludedLine(lineNumber(line));
        }
        return line !== 'end_of_record';
    });

    const functions = kept.filter(line => line.startsWith('FNDA:'));
    const functionHits = functions.filter(line => Number(line.slice(5).split(',', 1)[0]) > 0);
    const lines = kept.filter(line => line.startsWith('DA:'));
    const lineHits = lines.filter(line => Number(line.slice(3).split(',')[1]) > 0);
    const branches = kept.filter(line => line.startsWith('BRDA:'));
    const branchHits = branches.filter(line => line.slice(line.lastIndexOf(',') + 1) !== '-');

    return [
        ...kept,
        ...summary('FN', functions.length, functionHits.length),
        ...summary('L', lines.length, lineHits.length),
        ...summary('BR', branches.length, branchHits.length),
        'end_of_record',
    ];
}

export function filterRustLcov(lcov, readSource = path => readFileSync(path, 'utf8')) {
    const records = lcov
        .trimEnd()
        .split('end_of_record')
        .map(record => record.trim().split('\n').filter(Boolean))
        .filter(record => record.length > 0)
        .map(record => filterRecord(record, readSource));
    return `${records.map(record => record.join('\n')).join('\n')}\n`;
}

function lineCoverage(lcov) {
    let found = 0;
    let hit = 0;
    for (const line of lcov.split('\n')) {
        if (line.startsWith('LF:')) found += Number(line.slice(3));
        if (line.startsWith('LH:')) hit += Number(line.slice(3));
    }
    return { found, hit, percent: found === 0 ? 100 : (hit / found) * 100 };
}

/**
 * Fail when filtered production coverage does not meet the configured gate.
 *
 * The threshold belongs here rather than on `cargo llvm-cov`: the raw report
 * still contains inline tests and native-unreachable WASM adapters that this
 * script deliberately removes before Codecov sees the Rust flag.
 */
export function assertMinimumLineCoverage(lcov, minimum) {
    const coverage = lineCoverage(lcov);
    if (coverage.percent < minimum) {
        throw new Error(
            `Rust production line coverage ${coverage.hit}/${coverage.found} ` +
                `(${coverage.percent.toFixed(2)}%) is below the required ${minimum}%`,
        );
    }
    return coverage;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const reportPath = resolve(process.argv[2] ?? 'coverage/rust-lcov.info');
    const filtered = filterRustLcov(readFileSync(reportPath, 'utf8'));
    writeFileSync(reportPath, filtered);
    const coverage = assertMinimumLineCoverage(filtered, 100);
    console.log(
        `Rust production line coverage: ${coverage.hit}/${coverage.found} (${coverage.percent.toFixed(2)}%)`,
    );
}
