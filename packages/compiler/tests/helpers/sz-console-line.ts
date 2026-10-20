/**
 * Read a `[csszyx]` console line or build message back into its parts — a
 * test helper.
 *
 * Every line csszyx prints is headed by its code (`[csszyx] <code>:`), so a
 * suite reads what was reported from that token, never from the wording (ADR
 * 0031 item 12). With a place the header names it and the sentence follows on
 * its own line, two spaces in, as the engine's messages and a located runtime
 * line read; with none, the sentence follows the code. `help:`, `note:` and
 * `docs:` follow, each on its own line.
 *
 * @module sz-console-line
 */

/** A line's parts; `code` is `undefined` for a line no code heads. */
export interface SzConsoleLine {
    /** The code the line is headed by. */
    code: string | undefined;
    /** Where the diagnostic is, when the header names a place. */
    place?: string;
    /** The main sentence. */
    text: string;
    /** What to do. */
    help?: string;
    /** What happened to the output. */
    note?: string;
    /** The code's page. */
    docs?: string;
}

/** The header: the tag, the code and what follows it on the first line. */
const HEADER = /^\[csszyx\] ([a-z][a-z0-9]*(?:-[a-z0-9]+)*):(?: (.*))?$/;

/** A labelled line of the body. */
const LABELLED = /^ {2}(help|note|docs): (.*)$/;

/**
 * The code a line is headed by.
 *
 * @param message - A console line or build message.
 * @returns The code, or `undefined` when no `[csszyx] <code>:` heads it.
 */
export function szCodeOf(message: string): string | undefined {
    return HEADER.exec(message.split('\n', 1)[0] as string)?.[1];
}

/**
 * A line read back into its parts.
 *
 * @param message - A console line or build message.
 * @returns Its parts.
 */
export function parseSzConsoleLine(message: string): SzConsoleLine {
    const [first = '', ...rest] = message.split('\n');
    const header = HEADER.exec(first);
    if (header === null) return { code: undefined, text: message };
    const line: SzConsoleLine = { code: header[1], text: header[2] ?? '' };
    // A place in the header puts the sentence on the next line.
    const next = rest[0];
    if (next !== undefined && LABELLED.exec(next) === null && next.startsWith('  ')) {
        if (header[2] !== undefined) line.place = header[2];
        line.text = next.slice(2);
        rest.shift();
    }
    for (const body of rest) {
        const labelled = LABELLED.exec(body);
        if (labelled !== null) line[labelled[1] as 'help' | 'note' | 'docs'] = labelled[2];
    }
    return line;
}

/**
 * What a line says, as the two lanes must say it alike: the code and the
 * sentence, the advice and the note. The place is left out by design — the
 * runtime has no file position — and so is the link, which the code decides.
 *
 * @param message - A console line or build message.
 * @returns The body, as one comparable string.
 */
export function szBodyOf(message: string): string {
    const { code, text, help, note } = parseSzConsoleLine(message);
    return JSON.stringify({ code, text, help, note });
}

/**
 * The codes some lines report, the project-scan tip (`dev-warnings-partial`)
 * left out: it follows a key warning, and reports nothing of its own. A line
 * no code heads fails the call, since every line csszyx prints carries one, so
 * a suite comparing codes cannot pass on two lanes that both print prose.
 *
 * @param messages - Console lines.
 * @returns Their codes, in order.
 */
export function szReportedCodes(messages: readonly string[]): string[] {
    const codes: string[] = [];
    for (const message of messages) {
        const code = szCodeOf(message);
        if (code === undefined) throw new Error(`a line with no code: ${message}`);
        if (code !== 'dev-warnings-partial') codes.push(code);
    }
    return codes;
}
