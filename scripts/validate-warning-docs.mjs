import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Warning reference gate — every message the docs quote must still exist.
 *
 * `warnings.mdx` reproduces build and runtime messages verbatim so a reader can
 * match what their terminal printed against a table. That only works while the
 * quotes are true, and nothing made them true: the messages live in ~90 call
 * sites across nine packages plus the Rust engine, and rewording one is a
 * one-line change that leaves the page silently lying.
 *
 * This gate runs one direction only — every message quoted in the docs must be
 * findable in source. That direction is exact, so it can block merges today.
 * The opposite direction (source messages nobody documented) needs a baseline
 * before it can be enforced and is deliberately not checked here.
 *
 * Kept a plain script rather than a vitest test on purpose. A test living in a
 * package's own test directory inherits that package's turbo `inputs`, so
 * editing the MDX or another package's source does not invalidate the cached
 * result — measured: a wrong value injected into a docs table still replayed as
 * passing. Gates that read across the whole repo have to run outside turbo.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const DOC_PATH = 'apps/docs/src/content/docs/docs/reference/warnings.mdx';

/** Minimum words for a `[csszyx]`-prefixed inline span to count as a message. */
const MIN_INLINE_WORDS = 4;

/**
 * Minimum words for an UNPREFIXED inline span to count as a message.
 *
 * Not every quoted message carries the prefix: the fallback table splits each
 * one into a reason and a suggestion cell, and those are the wording most
 * likely to drift. A code span this long is a quote rather than prose, so the
 * length stands in for the missing marker.
 */
const MIN_UNPREFIXED_INLINE_WORDS = 8;

/** Minimum normalized word count for a line inside a text fence. */
const MIN_FENCE_WORDS = 6;

/** Words a fragment must reach to count toward a composed message. */
const MIN_RUN_WORDS = 2;

/**
 * Reduce a message to the words it is made of, so the same sentence compares
 * equal however its language spells the parts that vary.
 *
 * Everything removed here is a spelling difference rather than a wording one:
 * `${key}` and `{}` and `{column}` are all "a value goes here", Rust doubles a
 * brace it wants to print, MDX escapes a pipe inside a table cell, and both
 * languages break long strings across lines. What survives is the prose — which
 * is exactly what drifts when someone rewords a warning.
 *
 * @param text Raw message text from either a source file or the docs.
 * @returns Lowercased, space-separated words with all placeholders removed.
 */
export function normalizeMessage(text) {
    let s = String(text);

    // Rust breaks a long literal with a trailing backslash before the newline.
    s = s.replace(/\\\r?\n\s*/g, '');
    // TypeScript breaks one by closing a literal and reopening the next.
    s = s.replace(/(['"`])\s*\+\s*(['"`])/g, '');
    // MDX escapes characters that would otherwise be markup.
    s = s.replace(/\\([|"'`*_[\]{}])/g, '$1');
    // The prefix is added by the warn helpers, so call sites may omit it.
    s = s.replace(/\[csszyx\]/g, ' ');
    // Template interpolation: the expression inside is never part of the words.
    s = s.replace(/\$\{[^{}]*\}/g, ' ');

    // Placeholders, format specifiers, and Rust's doubled braces all reduce to
    // "something goes here". Innermost-first so nesting unwinds rather than
    // leaving a stray brace behind.
    let previous;
    do {
        previous = s;
        s = s.replace(/\{[^{}]*\}/g, ' ');
    } while (s !== previous);

    // Anything still not a word is punctuation, quoting, or leftover braces.
    return s
        .replace(/[^a-z0-9]+/gi, ' ')
        .trim()
        .toLowerCase();
}

/**
 * Count the words a normalized message carries.
 *
 * @param normalized Output of {@link normalizeMessage}.
 * @returns Number of words, zero for an empty string.
 */
function wordCount(normalized) {
    return normalized === '' ? 0 : normalized.split(' ').length;
}

/**
 * Pull the messages a docs page quotes verbatim.
 *
 * Two shapes carry them: an inline code span marked with the `[csszyx]` prefix,
 * and a line inside a ```text fence showing rendered terminal output. Prose that
 * merely mentions an option (`quiet: true`) is not a message, so an inline span
 * has to be prefixed to qualify — being conservative keeps a blocking gate
 * quiet enough to survive.
 *
 * @param mdx Raw MDX file contents.
 * @returns Messages with the 1-based line they appear on.
 */
export function extractDocumentedMessages(mdx) {
    const found = [];
    const lines = String(mdx).split('\n');
    let inFence = false;

    lines.forEach((line, index) => {
        if (/^\s*```/.test(line)) {
            inFence = !inFence;
            return;
        }

        if (inFence) {
            // A fence renders a whole terminal block, including a filename
            // header and indented detail lines built from example data. Only the
            // prefixed line is a message; the rest illustrates the layout.
            if (line.includes('[csszyx]') && wordCount(normalizeMessage(line)) >= MIN_FENCE_WORDS) {
                found.push({ text: line.trim(), line: index + 1 });
            }
            return;
        }

        for (const text of extractCodeSpans(line)) {
            const words = wordCount(normalizeMessage(text));
            const required = text.includes('[csszyx]')
                ? MIN_INLINE_WORDS
                : MIN_UNPREFIXED_INLINE_WORDS;
            if (words >= required) {
                found.push({ text, line: index + 1 });
            }
        }
    });

    return found;
}

/**
 * Pull the code spans from one Markdown line, following CommonMark's rule that
 * a span closes on a backtick run of the SAME length that opened it.
 *
 * The doubled backtick does two different jobs on this page, and a regex cannot
 * tell them apart. It marks a whole message whose text contains code
 * (``function call `{detail}()` result is unknown``), and it marks code inside a
 * message that is already a span (`… the default ``rust`` parser …`). Treating
 * every doubled run the first way splits the second kind in half; treating them
 * all the second way drops the fallback table's reasons entirely. Both mistakes
 * were measured here.
 *
 * @param line One line of Markdown.
 * @returns The text inside each top-level code span.
 */
export function extractCodeSpans(line) {
    const spans = [];
    let i = 0;
    while (i < line.length) {
        if (line[i] !== '`') {
            i++;
            continue;
        }
        let openLength = 0;
        while (line[i + openLength] === '`') openLength++;
        const start = i + openLength;

        let j = start;
        let content = '';
        while (j < line.length) {
            if (line[j] !== '`') {
                content += line[j];
                j++;
                continue;
            }
            let runLength = 0;
            while (line[j + runLength] === '`') runLength++;
            if (runLength === openLength) break;
            // A different run length is literal text inside this span, so the
            // markers are dropped and the words they wrap are kept.
            j += runLength;
        }
        if (j >= line.length) {
            // Unterminated: not a span, so do not swallow the rest of the line.
            i = start;
            continue;
        }
        spans.push(content);
        i = j + openLength;
    }
    return spans;
}

/**
 * Longest run of consecutive words from `message` that the haystack contains.
 *
 * @param message Normalized message text.
 * @param haystack Normalized literals from every source file.
 * @returns Length in words of the longest run found, zero when none is.
 */
export function longestAnchoredRun(message, haystack) {
    const words = message === '' ? [] : message.split(' ');
    let best = 0;
    for (let start = 0; start < words.length; start++) {
        let length = 0;
        while (
            start + length < words.length &&
            haystack.includes(words.slice(start, start + length + 1).join(' '))
        ) {
            length++;
        }
        if (length > best) best = length;
    }
    return best;
}

/**
 * Find documented messages that source no longer anchors.
 *
 * An exact whole-message match is the wrong test, and measuring proved it: the
 * page deliberately shows some messages as the user sees them, with the runtime
 * values already substituted (`active parser: rust (native engine)`), and other
 * messages are assembled from several literals at the point of printing. Neither
 * exists verbatim in any single source string, yet both are correct docs.
 *
 * Requiring one long verbatim run instead was measurably too weak: rewording the
 * middle of a long message still left a different untouched run to satisfy it,
 * and a real two-file rewording passed. So every word has to be accounted for —
 * see {@link isFullyComposed}.
 *
 * @param documented Messages from {@link extractDocumentedMessages}.
 * @param haystack Normalized literals from every source file.
 * @returns Entries that source no longer accounts for.
 */
export function findMissingMessages(documented, haystack) {
    const missing = [];
    for (const entry of documented) {
        const normalized = normalizeMessage(entry.text);
        if (isFullyComposed(normalized, haystack)) {
            continue;
        }
        missing.push({
            ...entry,
            anchor: longestAnchoredRun(normalized, haystack),
            required: wordCount(normalized),
        });
    }
    return missing;
}

/**
 * Whether every word of a message is accounted for by source fragments.
 *
 * A message printed as `active parser: ${detail}` exists in source as two short
 * literals and never as one, so no single run reaches the anchor length. Walking
 * it greedily and demanding each step land on a real fragment still holds it to
 * source: measured against reworded variants of a real message, changing either
 * the middle or the tail breaks the walk, because the new phrasing is not a
 * fragment anywhere.
 *
 * @param normalized Normalized message text.
 * @param haystack Normalized literals from every source file.
 * @returns True when the whole message is covered by fragments.
 */
export function isFullyComposed(normalized, haystack) {
    const words = normalized === '' ? [] : normalized.split(' ');
    let position = 0;
    while (position < words.length) {
        let length = 0;
        while (
            position + length < words.length &&
            haystack.includes(words.slice(position, position + length + 1).join(' '))
        ) {
            length++;
        }
        if (length < MIN_RUN_WORDS) {
            return false;
        }
        position += length;
    }
    return words.length > 0;
}

/**
 * List the tracked source files that can declare a message.
 *
 * `git ls-files` rather than a directory walk: it already excludes build output,
 * `node_modules` and the tsc emit directory, and it is the same tracked-file
 * notion the other repo gates use.
 *
 * @param repositoryRoot Absolute path to the repository root.
 * @returns Repository-relative paths of TypeScript and Rust sources.
 */
export function listSourceFiles(repositoryRoot) {
    const output = execFileSync('git', ['ls-files', 'packages/*/src/**'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    });
    return output.split('\n').filter(file => /\.(ts|tsx|rs)$/.test(file) && !/\.d\.ts$/.test(file));
}

/**
 * Collect every string literal a source file declares, normalized.
 *
 * Only literals, never whole files: the placeholder-stripping pass removes
 * balanced brace groups, and running that over real code eats every block until
 * nothing is left. Concatenation glue is removed first so a message split
 * across adjacent literals is rejoined before extraction sees it.
 *
 * Each literal is normalized on its own and the results are newline-joined, so
 * a documented message has to be found inside a single literal rather than
 * accidentally spanning two unrelated ones.
 *
 * @param source Raw contents of one source file.
 * @returns Normalized literal texts, one per entry.
 */
export function extractSourceLiterals(source, { rust = false } = {}) {
    const text = String(source);
    const spans = [];
    let i = 0;
    /** Last non-whitespace character seen in code, used to classify `/`. */
    let previousCode = '';

    while (i < text.length) {
        const c = text[i];

        // A `/` is a regex only where a value may start; after an identifier,
        // number, or closing bracket it is division. Without this a pattern such
        // as `/"([^"]+)"/` opens a string and every message after it is lost.
        if (!rust && c === '/' && text[i + 1] !== '/' && text[i + 1] !== '*') {
            if (previousCode === '' || !/[\w$)\]]/.test(previousCode)) {
                let j = i + 1;
                let inClass = false;
                while (j < text.length && text[j] !== '\n') {
                    if (text[j] === '\\') {
                        j += 2;
                        continue;
                    }
                    if (text[j] === '[') inClass = true;
                    else if (text[j] === ']') inClass = false;
                    else if (text[j] === '/' && !inClass) break;
                    j++;
                }
                if (text[j] === '/') {
                    previousCode = '/';
                    i = j + 1;
                    continue;
                }
            }
        }

        if (c === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
            i += 2;
            continue;
        }

        // Rust raw strings carry their own delimiter length: r#"…"#, r##"…"##.
        if (rust && c === 'r' && (text[i + 1] === '"' || text[i + 1] === '#')) {
            let hashes = 0;
            let j = i + 1;
            while (text[j] === '#') {
                hashes++;
                j++;
            }
            if (text[j] === '"') {
                const start = j + 1;
                const terminator = `"${'#'.repeat(hashes)}`;
                const end = text.indexOf(terminator, start);
                if (end !== -1) {
                    spans.push({
                        text: text.slice(start, end),
                        start: i,
                        end: end + terminator.length,
                    });
                    i = end + terminator.length;
                    continue;
                }
            }
        }

        // Rust strings are always double-quoted. A single quote there opens a
        // lifetime (`&'a str`) or a char literal, and a char literal may hold a
        // quote of its own (`'"'`) — stepping over it blindly leaves that quote
        // unmatched and desynchronizes everything after it.
        if (rust && c === "'") {
            const escaped = text[i + 1] === '\\';
            const close = text.indexOf("'", escaped ? i + 3 : i + 2);
            // A char literal closes within a few characters; a lifetime never
            // closes, so anything further away is an unrelated quote.
            i = close !== -1 && close - i <= 12 ? close + 1 : i + 1;
            continue;
        }

        const isDelimiter = c === '"' || c === '`' || (!rust && c === "'");
        if (isDelimiter) {
            const start = i + 1;
            let j = start;
            while (j < text.length) {
                if (text[j] === '\\') {
                    j += 2;
                    continue;
                }
                if (text[j] === c) break;
                j++;
            }
            spans.push({ text: text.slice(start, j), start: i, end: j + 1 });
            previousCode = c;
            i = j + 1;
            continue;
        }

        if (!/\s/.test(c)) {
            previousCode = c;
        }
        i++;
    }

    // A message split across adjacent literals is one message: merge spans whose
    // only separation is concatenation glue.
    const literals = [];
    let pending = null;
    for (const span of spans) {
        if (pending && /^\s*\+\s*$/.test(text.slice(pending.end, span.start))) {
            pending = { text: pending.text + span.text, start: pending.start, end: span.end };
            continue;
        }
        if (pending) literals.push(pending);
        pending = span;
    }
    if (pending) literals.push(pending);

    return literals.map(span => normalizeMessage(span.text)).filter(entry => entry !== '');
}

/**
 * Read every source file and reduce it to its normalized string literals.
 *
 * Deliberately not prefiltered to files matching `[csszyx]`: the runtime warns
 * through `devWarn`, which adds the prefix itself, so such a filter would go
 * blind to that entire family. Reading all of them costs a few tens of ms.
 *
 * @param repositoryRoot Absolute path to the repository root.
 * @param files Repository-relative source paths.
 * @returns One newline-joined string of every normalized literal.
 */
export function buildSourceHaystack(repositoryRoot, files) {
    const literals = [];
    for (const file of files) {
        literals.push(
            ...extractSourceLiterals(readFileSync(path.join(repositoryRoot, file), 'utf8'), {
                rust: file.endsWith('.rs'),
            }),
        );
    }
    return literals.join('\n');
}

/**
 * Run the gate, printing every documented message that source no longer has.
 *
 * @returns Process exit code: 0 when the docs match, 1 when they do not.
 */
export function main() {
    const mdx = readFileSync(path.join(REPO_ROOT, DOC_PATH), 'utf8');
    const documented = extractDocumentedMessages(mdx);

    if (documented.length === 0) {
        console.error(
            `[warning-docs] Extracted no messages from ${DOC_PATH}. The page or the ` +
                'extractor changed shape — a gate that checks nothing must not pass.',
        );
        return 1;
    }

    const files = listSourceFiles(REPO_ROOT);
    const haystack = buildSourceHaystack(REPO_ROOT, files);
    const missing = findMissingMessages(documented, haystack);

    if (missing.length > 0) {
        console.error(
            `[warning-docs] ${missing.length} of ${documented.length} documented message(s) ` +
                `are no longer anchored in ${files.length} source files:\n`,
        );
        for (const entry of missing) {
            console.error(
                `  ${DOC_PATH}:${entry.line}  (longest verbatim run: ${entry.anchor}/${entry.required} words)`,
            );
            console.error(`    ${entry.text.slice(0, 160)}\n`);
        }
        console.error(
            'Either the message was reworded (update the docs to match the source) or it ' +
                'was removed (drop the row). Placeholders, line breaks and substituted ' +
                'values are all ignored, so only the wording itself can differ.',
        );
        return 1;
    }

    console.log(
        `[warning-docs] ${documented.length} documented message(s) verified against ` +
            `${files.length} source files.`,
    );
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(main());
}
