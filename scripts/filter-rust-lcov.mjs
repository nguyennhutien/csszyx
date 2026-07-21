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

function filterRecord(record, readSource) {
    const sourceFile = record.find(line => line.startsWith('SF:'))?.slice(3);
    if (!sourceFile?.includes('/packages/core/src/')) return [...record, 'end_of_record'];

    const source = readSource(sourceFile);
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

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
    const reportPath = resolve(process.argv[2] ?? 'coverage/rust-lcov.info');
    const filtered = filterRustLcov(readFileSync(reportPath, 'utf8'));
    writeFileSync(reportPath, filtered);
    const coverage = lineCoverage(filtered);
    console.log(
        `Rust production line coverage: ${coverage.hit}/${coverage.found} (${coverage.percent.toFixed(2)}%)`,
    );
}
