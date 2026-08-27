/**
 * Every regex in changed source that matches an HTML tag must be able to see
 * the tag however a browser would spell it.
 *
 * A csszyx invariant, NOT a stand-in for CodeQL. `pnpm codeql:local` runs the
 * real queries; running the service's own tool rather than re-implementing its
 * logic is settled policy here, because a text match cannot answer the
 * reachability question CodeQL asks, and a rule that catches a minimal example
 * has not been shown to catch a real one. Run both — neither replaces the other.
 *
 * What this owns is narrower and belongs to this repository. csszyx asserts
 * that no build emits executable inline script, and the assertions proving it
 * are regexes over built HTML. Such a filter fails OPEN: `/<script>/` reports a
 * clean page for `<SCRIPT>` and for `</script >`, both of which a browser runs,
 * so the suite keeps reporting the property holds while it breaks.
 *
 * Scoped to changed files, the way the Sonar mirrors are, because the rule is
 * about what a change introduces.
 *
 * Run: node scripts/check-tag-filter-regexes.mjs [baseRef]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const baseRef = process.argv[2] ?? 'origin/main';

/** Tag names whose spelling a browser treats case-insensitively. */
const TAG = String.raw`<\/?\s*(script|iframe|object|embed|style|img|svg|a)\b`;

/**
 * @returns changed files this check applies to.
 */
function changedFiles() {
    const range = `${baseRef}...HEAD`;
    const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', range], {
        encoding: 'utf8',
    });
    return out
        .split('\n')
        .filter(name => /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/.test(name))
        .filter(name => !name.includes('node_modules/'));
}

/**
 * Find regex literals in a source file and report the ones that filter a tag
 * without being able to see every spelling of it.
 *
 * @param file - path to read.
 * @returns one finding per unsound literal.
 */
function findingsIn(file) {
    let source;
    try {
        source = readFileSync(file, 'utf8');
    } catch {
        return [];
    }
    const findings = [];
    // A regex literal on one line: an opening slash, a body with no unescaped
    // slash or newline, a closing slash, then flags.
    const literal = /\/((?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+)\/([dgimsuvy]*)/g;
    source.split('\n').forEach((line, index) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const match of line.matchAll(literal)) {
            const [, body, flags] = match;
            if (!new RegExp(TAG, 'i').test(body)) continue;
            const reasons = [];
            if (!flags.includes('i')) reasons.push('no `i` flag, so an upper-case tag slips past');
            // A close tag may carry anything up to its `>`. Tolerating only
            // whitespace is still too strict: CodeQL rejected a pattern ending
            // in `\\s*>` for missing a close tag with an attribute after the
            // name, which a browser accepts and runs.
            if (/<\\?\/[a-z]+(\\s\*)?>/i.test(body)) {
                reasons.push('close tag must allow anything up to `>` — `</tag foo>` is legal');
            }
            if (reasons.length > 0) {
                findings.push({ file, line: index + 1, source: match[0], reasons });
            }
        }
    });
    return findings;
}

const findings = changedFiles().flatMap(findingsIn);

if (findings.length === 0) {
    console.log('[tag-filter] Every changed tag-matching regex sees the tag in any spelling.');
    process.exit(0);
}

for (const finding of findings) {
    console.error(`\n${finding.file}:${finding.line}  ${finding.source}`);
    for (const reason of finding.reasons) console.error(`    - ${reason}`);
}
console.error(
    `\n✖ ${findings.length} tag-matching regex(es) can miss a spelling a browser accepts.` +
        '\n  Add the `i` flag, and match a close tag as `<\\/tag[^>]*>`.' +
        '\n  CodeQL reports this class too, as js/bad-tag-filter. Run `pnpm codeql:local`' +
        '\n  for the real queries — this check does not stand in for them.',
);
process.exit(1);
