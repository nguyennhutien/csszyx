/**
 * Shared statistics and run-recording for the benchmark harnesses.
 *
 * Two jobs, both of which used to be missing or duplicated:
 *
 * 1. **One `median`.** Six harnesses carried their own copy, differing only in
 *    what they returned for an empty sample — 0 in one, `NaN` in another,
 *    `undefined` arithmetic in the rest. A statistic defined six times is a
 *    statistic that will eventually disagree with itself.
 * 2. **A dispersion figure next to every central figure.** A median alone
 *    cannot be read: `12 ms` from a sample that ranged 11–13 and `12 ms` from
 *    one that ranged 4–90 are the same number and completely different
 *    evidence. `p95` and the coefficient of variation say which one you have,
 *    and a reader can tell a real change from noise without re-running.
 *
 * The recorder writes one JSON line per run under `.bench-history/`, keyed by
 * commit and machine. That file is the prerequisite for change point detection:
 * a threshold has to be invented, whereas a change point is found in a series.
 * The directory is gitignored and therefore LOCAL — a series only covers the
 * machine that produced it. Publishing it (a CI artifact, a data branch) is a
 * separate decision and is not made here.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Median of a sample.
 *
 * `NaN` for an empty sample: there is no median of nothing, and returning 0
 * there — as three of the six harness-local copies did — reads downstream as a
 * measurement of zero milliseconds.
 *
 * @param values Sample.
 * @returns The median, or `NaN` for an empty sample.
 */
export function median(values: readonly number[]): number {
    if (values.length === 0) return Number.NaN;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
        : (sorted[middle] as number);
}

/**
 * Nearest-rank percentile.
 *
 * Nearest-rank rather than an interpolating variant because a benchmark sample
 * is small: with 7 iterations, interpolation invents a value between two real
 * measurements and reports it as if it had been observed.
 *
 * @param values Sample.
 * @param fraction Percentile as a fraction, e.g. `0.95`.
 * @returns The value at that rank, or `NaN` for an empty sample.
 */
export function percentile(values: readonly number[], fraction: number): number {
    if (values.length === 0) return Number.NaN;
    const sorted = [...values].sort((left, right) => left - right);
    const rank = Math.ceil(fraction * sorted.length) - 1;
    return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)] as number;
}

/**
 * Arithmetic mean.
 *
 * @param values Sample.
 * @returns The mean, or `NaN` for an empty sample.
 */
export function mean(values: readonly number[]): number {
    if (values.length === 0) return Number.NaN;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Sample standard deviation, Bessel-corrected.
 *
 * @param values Sample.
 * @returns The standard deviation, or `NaN` below two samples.
 */
export function standardDeviation(values: readonly number[]): number {
    if (values.length < 2) return Number.NaN;
    const average = mean(values);
    const sumSquares = values.reduce((sum, value) => sum + (value - average) ** 2, 0);
    return Math.sqrt(sumSquares / (values.length - 1));
}

/**
 * Coefficient of variation, as a percentage of the mean.
 *
 * Unitless on purpose: it is the one dispersion figure that compares across
 * benchmarks measuring different things, so "which of these numbers can I
 * trust" has one answer to read.
 *
 * @param values Sample.
 * @returns CV in percent, or `NaN` when it is undefined (fewer than two
 *   samples, or a mean of zero).
 */
export function coefficientOfVariation(values: readonly number[]): number {
    const average = mean(values);
    if (!Number.isFinite(average) || average === 0) return Number.NaN;
    return (standardDeviation(values) / average) * 100;
}

/** A sample reduced to the figures a reader needs to judge it. */
export interface Dispersion {
    /** Number of samples behind the figures. */
    samples: number;
    /** Central figure. */
    median: number;
    /** Fastest observation — the floor this machine reached. */
    min: number;
    /** 95th percentile, nearest rank. */
    p95: number;
    /** Coefficient of variation, percent of mean. */
    cvPercent: number;
}

/**
 * Reduces a sample to median plus dispersion.
 *
 * @param values Sample.
 * @returns The figures, with `NaN` where a statistic is undefined.
 */
export function summarize(values: readonly number[]): Dispersion {
    return {
        samples: values.length,
        median: median(values),
        min: values.length === 0 ? Number.NaN : Math.min(...values),
        p95: percentile(values, 0.95),
        cvPercent: coefficientOfVariation(values),
    };
}

/**
 * Formats dispersion for a report line.
 *
 * The CV is what a reader checks first, so it is not hidden behind a decimal
 * they have to compute: above 5 % the median is not a number to compare
 * against yesterday's.
 *
 * @param dispersion Figures from `summarize`.
 * @param unit Unit suffix for the central figures.
 * @returns A single-line summary.
 */
export function formatDispersion(dispersion: Dispersion, unit = 'ms'): string {
    const round = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : 'n/a');
    const cv = Number.isFinite(dispersion.cvPercent)
        ? `${dispersion.cvPercent.toFixed(1)}%`
        : 'n/a';
    return (
        `${round(dispersion.median)} ${unit} median · ` +
        `p95 ${round(dispersion.p95)} ${unit} · ` +
        `min ${round(dispersion.min)} ${unit} · ` +
        `CV ${cv} · n=${dispersion.samples}`
    );
}

/** Commit the measurement was taken at, and whether the tree was clean. */
export interface GitState {
    sha: string;
    /** A dirty tree cannot join a time series: the code measured is unnamed. */
    dirty: boolean;
}

/**
 * Reads the commit and dirty flag.
 *
 * @returns The git state, or `null` outside a git checkout.
 */
export function gitState(): GitState | null {
    try {
        const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
        }).trim();
        const status = execFileSync('git', ['status', '--porcelain'], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
        });
        return { sha, dirty: status.trim().length > 0 };
    } catch {
        return null;
    }
}

/** What a measurement is comparable against: the machine that produced it. */
export interface MachineState {
    platform: string;
    arch: string;
    cpuModel: string;
    cpuCount: number;
    totalMemoryGiB: number;
    nodeVersion: string;
    /** Container CPU/memory limits differ from the host's, so runs must not mix. */
    container: boolean;
}

/**
 * Describes the current machine.
 *
 * @returns The fields that decide whether two runs are comparable.
 */
export function machineState(): MachineState {
    const cores = cpus();
    return {
        platform: process.platform,
        arch: process.arch,
        cpuModel: cores[0]?.model ?? 'unknown',
        cpuCount: cores.length,
        totalMemoryGiB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
        nodeVersion: process.version,
        container: inContainer(),
    };
}

/**
 * Whether this process runs inside a container.
 *
 * `/.dockerenv` is the signal that actually holds: the devcontainer env vars an
 * editor sets (`REMOTE_CONTAINERS`, `CODESPACES`) are absent in a shell started
 * any other way, and a run recorded as host when it was containerised joins the
 * wrong series — container CPU and memory limits differ from the host's, which
 * is the whole reason the field exists.
 *
 * @returns True when a container marker is present.
 */
function inContainer(): boolean {
    return (
        existsSync('/.dockerenv') ||
        process.env.REMOTE_CONTAINERS === 'true' ||
        process.env.CODESPACES === 'true'
    );
}

/** One recorded run of one benchmark. */
export interface BenchRecord {
    /** Bumped when the envelope shape changes, so a reader can reject old lines. */
    schema: 1;
    /** Harness name, e.g. `transform-cache`. */
    benchmark: string;
    recordedAt: string;
    git: GitState | null;
    machine: MachineState;
    /** Harness-shaped measurements. One entry per row the report prints. */
    rows: readonly Record<string, unknown>[];
}

/**
 * Where the history for one benchmark lives.
 *
 * @param benchmark Harness name; becomes the filename.
 * @returns Absolute path to that benchmark's JSON Lines file.
 */
export function historyPath(benchmark: string): string {
    const base = process.env.CSSZYX_BENCH_HISTORY_DIR ?? join(REPO_ROOT, '.bench-history');
    return join(base, `${benchmark}.jsonl`);
}

/**
 * Appends one run to this benchmark's local history.
 *
 * Append-only JSON Lines: a run is one line, a series is the file, and a
 * partially written line can be dropped by the reader without losing the rest.
 * Set `CSSZYX_BENCH_HISTORY=0` to skip recording.
 *
 * @param benchmark Harness name; becomes the filename.
 * @param rows Measurements, in the shape the harness reports them.
 * @returns The file written, or `null` when recording is off or failed.
 */
export function recordBenchRun(
    benchmark: string,
    rows: readonly Record<string, unknown>[],
): string | null {
    if (process.env.CSSZYX_BENCH_HISTORY === '0') return null;
    const record: BenchRecord = {
        schema: 1,
        benchmark,
        recordedAt: new Date().toISOString(),
        git: gitState(),
        machine: machineState(),
        rows,
    };
    const target = historyPath(benchmark);
    try {
        mkdirSync(dirname(target), { recursive: true });
        appendFileSync(target, `${JSON.stringify(record)}\n`, 'utf8');
        return target;
    } catch {
        // A benchmark must still report its numbers when the history cannot be
        // written — a read-only checkout is not a reason to lose the run.
        return null;
    }
}
