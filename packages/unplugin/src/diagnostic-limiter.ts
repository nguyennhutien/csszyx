/**
 * How many times a lane lists one finding, and how many findings of one id.
 *
 * A dev server compiles a module again for reasons that have nothing to do
 * with its source — a stylesheet edit, a merge-table change, another layer —
 * and every pass used to print the same lines again. A project with one bad
 * habit repeated over a hundred files printed a hundred lines of it, burying
 * the one finding that was new. So a finding is listed once per process while
 * its file is unchanged, keyed by (id, file, line, key), and each id lists at
 * most {@link DIAGNOSTIC_LINE_CAP} lines per start or build before one line
 * says how many more there are and where to read them all.
 *
 * An edit is what makes a finding worth saying again: a lane tells the limiter
 * the version of each file it reports on, and a new version forgets what was
 * listed for the old one.
 *
 * @module
 */

/** Lines one id lists per start or build before the rest are only counted. */
export const DIAGNOSTIC_LINE_CAP = 10;

/** One finding, as the limiter tells two apart. */
export interface LimitedFinding {
    /** The rule or kind id, such as `unknown-key` or `dead-class`. */
    id: string;
    /** The file it is in, as the lane names it. */
    file: string;
    /** Its line, when the lane knows one. */
    line?: number;
    /** What else tells two findings on one line apart, such as the message. */
    key: string;
}

/** The dedupe record and the cap of one lane. */
export interface DiagnosticLimiter {
    /**
     * Note the version of a file about to be reported on; a version other than
     * the last one forgets every finding listed for the file.
     */
    version(file: string, version: string): void;
    /** Whether to list a finding now: false for a repeat, or past the cap. */
    admit(finding: LimitedFinding): boolean;
    /** Whether a finding was held back by the cap since the last flush. */
    readonly pending: boolean;
    /** The lines saying how many each id held back; opens the next start or build. */
    flush(): string[];
}

/**
 * The line that closes a capped id.
 *
 * @param id - The rule or kind id.
 * @param count - How many findings of it were not listed.
 * @returns The line, `[csszyx]`-prefixed.
 */
export function capOverflowMessage(id: string, count: number): string {
    return `[csszyx] +${count} more ${id} — help: \`csszyx check --rule ${id}\` lists every one.`;
}

/** What was listed for one file, and for which version of it. */
interface FileRecord {
    version: string | undefined;
    listed: Set<string>;
}

/**
 * Create the record one lane keeps for the life of its process.
 *
 * Memory is bounded by the findings of the current version of each file.
 *
 * @param cap - Lines per id per start or build.
 * @returns The limiter.
 */
export function createDiagnosticLimiter(cap: number = DIAGNOSTIC_LINE_CAP): DiagnosticLimiter {
    const files = new Map<string, FileRecord>();
    const listedPerId = new Map<string, number>();
    const heldPerId = new Map<string, number>();
    const recordOf = (file: string): FileRecord => {
        let record = files.get(file);
        if (record === undefined) {
            record = { version: undefined, listed: new Set() };
            files.set(file, record);
        }
        return record;
    };
    return {
        version(file, version) {
            const record = recordOf(file);
            if (record.version === version) return;
            record.version = version;
            record.listed.clear();
        },
        admit({ id, file, line, key }) {
            const record = recordOf(file);
            const identity = `${id}\0${line ?? ''}\0${key}`;
            if (record.listed.has(identity)) return false;
            const listed = listedPerId.get(id) ?? 0;
            if (listed >= cap) {
                // Not recorded as listed: it was never shown, so the next start
                // or build that has room for it lists it.
                heldPerId.set(id, (heldPerId.get(id) ?? 0) + 1);
                return false;
            }
            listedPerId.set(id, listed + 1);
            record.listed.add(identity);
            return true;
        },
        get pending() {
            return heldPerId.size > 0;
        },
        flush() {
            const lines = [...heldPerId].map(([id, count]) => capOverflowMessage(id, count));
            heldPerId.clear();
            listedPerId.clear();
            return lines;
        },
    };
}

/** When a lane prints what its cap held back. */
export interface CapFlush {
    /**
     * Print it once the current burst of reports is over, on a timer that
     * does not hold the process open: a dev server, a loader and jest have no
     * build end to print it at.
     */
    schedule(): void;
    /** Print it now, at the end of a build. */
    now(): void;
}

/**
 * Tie a limiter's overflow lines to the console.
 *
 * @param limiter - The lane's limiter.
 * @param delayMs - How long a burst of reports may pause before it counts as over.
 * @returns The two moments a lane prints them at.
 */
export function createCapFlush(limiter: DiagnosticLimiter, delayMs = 1000): CapFlush {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const now = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        for (const line of limiter.flush()) console.warn(line);
    };
    return {
        schedule() {
            if (!limiter.pending || timer !== undefined) return;
            timer = setTimeout(now, delayMs);
            timer.unref?.();
        },
        now,
    };
}
