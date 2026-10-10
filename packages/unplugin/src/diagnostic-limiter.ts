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
 * the version of each file it transforms — with or without findings, so an
 * undo back to a version that had them is a new version too — and a new
 * version forgets what was listed for the old one.
 *
 * On a dev server "a start" is one burst of compiles: the cap opens again once
 * a burst has paused, so the eleventh new finding an hour later is listed with
 * its location rather than folded into a count.
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
    /** Its column, when the lane knows one: two findings can share a line. */
    column?: number;
    /** What else tells two findings on one line apart, such as the message. */
    key: string;
}

/** The dedupe record and the cap of one lane. */
export interface DiagnosticLimiter {
    /**
     * Note the version of a file about to be reported on; a version other than
     * the last one forgets every finding listed or held back for the file.
     */
    version(file: string, version: string): void;
    /** Whether to list a finding now: false for a repeat, or past the cap. */
    admit(finding: LimitedFinding): boolean;
    /**
     * Forget every finding of an id listed or held back earlier that is not
     * among these.
     *
     * For a report taken over the whole project, such as `dead-class`, whose
     * findings outlive no file version: a finding that went away and came back
     * is said again.
     *
     * @param id - The id the report covers.
     * @param present - Every finding of it the report has now.
     */
    retain(id: string, present: readonly LimitedFinding[]): void;
    /** Whether a finding was held back by the cap since the last flush. */
    readonly pending: boolean;
    /** Whether anything was listed or held since the last flush. */
    readonly counting: boolean;
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
 * What tells two findings of one file apart, the id first so a report can
 * find its own.
 *
 * @param finding - The finding.
 * @returns The identity within its file.
 */
function identityOf(finding: LimitedFinding): string {
    const { id, line, column, key } = finding;
    return `${id}\0${line ?? ''}\0${column ?? ''}\0${key}`;
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
    // The findings held, not the attempts: a module compiled for two layers
    // reports the same held finding twice, and the closing line counts findings.
    const heldPerId = new Map<string, Set<string>>();
    // A held finding that a new file version fixed or moved, or that a report
    // no longer carries, is not one more to count.
    const forgetHeld = (drop: (heldKey: string, id: string) => boolean): void => {
        for (const [id, held] of heldPerId) {
            for (const heldKey of held) if (drop(heldKey, id)) held.delete(heldKey);
            if (held.size === 0) heldPerId.delete(id);
        }
    };
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
            const prefix = `${file}\0`;
            forgetHeld(heldKey => heldKey.startsWith(prefix));
        },
        admit(finding) {
            const record = recordOf(finding.file);
            const identity = identityOf(finding);
            if (record.listed.has(identity)) return false;
            const listed = listedPerId.get(finding.id) ?? 0;
            if (listed >= cap) {
                // Not recorded as listed: it was never shown, so the next start
                // or build that has room for it lists it.
                let held = heldPerId.get(finding.id);
                if (held === undefined) {
                    held = new Set();
                    heldPerId.set(finding.id, held);
                }
                held.add(`${finding.file}\0${identity}`);
                return false;
            }
            listedPerId.set(finding.id, listed + 1);
            record.listed.add(identity);
            return true;
        },
        retain(id, present) {
            const kept = new Set(present.map(finding => `${finding.file}\0${identityOf(finding)}`));
            const prefix = `${id}\0`;
            for (const [file, record] of files) {
                for (const identity of record.listed) {
                    if (identity.startsWith(prefix) && !kept.has(`${file}\0${identity}`)) {
                        record.listed.delete(identity);
                    }
                }
            }
            forgetHeld((heldKey, heldId) => heldId === id && !kept.has(heldKey));
        },
        get pending() {
            return heldPerId.size > 0;
        },
        get counting() {
            return listedPerId.size > 0 || heldPerId.size > 0;
        },
        flush() {
            const lines = [...heldPerId].map(([id, held]) => capOverflowMessage(id, held.size));
            heldPerId.clear();
            listedPerId.clear();
            return lines;
        },
    };
}

/** When a lane prints what its cap held back. */
export interface CapFlush {
    /**
     * Print it once the current burst of reports has paused, and open the cap
     * for the next burst, on a timer that does not hold the process open: a
     * dev server, a loader and jest have no build end to print it at. A
     * process that ends first prints it as it exits.
     */
    schedule(): void;
    /** Print it now, at the end of a build. */
    now(): void;
}

/** The flushes waiting on a timer, printed if the process ends first. */
const flushesAtExit = new Set<() => void>();

/** Whether the one `exit` listener every flush shares is installed. */
let exitListenerInstalled = false;

/** Print every flush still waiting; `exit` runs synchronous code only, which this is. */
function flushAllAtExit(): void {
    // A flush removes itself; deleting the entry being visited is safe.
    for (const flush of flushesAtExit) flush();
}

/**
 * Tie a limiter's overflow lines to the console.
 *
 * @param limiter - The lane's limiter.
 * @param delayMs - How long a burst of reports must pause before it counts as over.
 * @returns The two moments a lane prints them at.
 */
export function createCapFlush(limiter: DiagnosticLimiter, delayMs = 1000): CapFlush {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const now = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        flushesAtExit.delete(now);
        for (const line of limiter.flush()) console.warn(line);
    };
    return {
        schedule() {
            // A burst that listed anything ends a start, held count or not.
            if (!limiter.counting) return;
            if (timer !== undefined) clearTimeout(timer);
            timer = setTimeout(now, delayMs);
            timer.unref?.();
            flushesAtExit.add(now);
            if (!exitListenerInstalled) {
                exitListenerInstalled = true;
                process.once('exit', flushAllAtExit);
            }
        },
        now,
    };
}
