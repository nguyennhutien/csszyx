/**
 * Gate: every Tailwind utility that Tailwind ACTUALLY SERVES and that appears in
 * the pinned corpora must be classifiable by `@csszyx/runtime`'s `classify`.
 *
 * `classify` reads the className string an application wrote, while
 * `box-role-map.generated.ts` is projected from the compiler's `PROPERTY_MAP` —
 * it describes what csszyx EMITS. Those two vocabularies are not the same set,
 * and nothing measured the difference until this script: `placeholder-*` and
 * `start-*`/`end-*` had been unclassified since `classify` shipped, which
 * dropped them from `pick`, kept them in `omit`, and routed them by
 * `splitBox`'s fallback. Measured on `bfeea221`: 1449/1459.
 *
 * The oracle is Tailwind itself, not a hand-written list of "real" classes. A
 * corpus line counts only when compiling it emits CSS that compiling nothing
 * did not — so prose accidentally scraped into a corpus (`should`, `and`), a
 * project's own `@utility` (`no-scrollbar`, `cn-menu-target`) and a third-party
 * plugin's utilities (`fade-out-0`) all fall out on their own. Those are out of
 * scope by decision, not by omission: the toolkit's vocabulary is atomic
 * utilities, and a class declaring several properties at once has no correct
 * side to be routed to.
 *
 * `group` and `peer` are the converse case — classified here, served by nobody,
 * because they emit no CSS at all. This gate cannot see them, so their routing
 * is held by `runtime/tests/split-box-tailwind-vocabulary.test.ts` instead.
 *
 * Usage: node --import tsx/esm scripts/check-classify-coverage.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const corpusDir = join(repoRoot, 'scripts/corpus');

/**
 * How many served utilities the corpora yield today, pinned exactly.
 *
 * Without it this gate has the failure shape it exists to catch: if the oracle
 * stops answering — a Tailwind upgrade changing `build`'s semantics, a corpus
 * that failed to load — every candidate reads as "not served", nothing is
 * checked, and a run that measured nothing reports success.
 *
 * A floor was the first attempt and it is not enough: any aggregate ceiling
 * catches TOTAL blindness while letting partial blindness through, and partial
 * is the likelier failure. With a floor of 1400 against 1459 served, sixty
 * utilities could stop being measured and the gate would still print 100%.
 * Only a pinned expectation notices one.
 *
 * The cost is a deliberate bump whenever the corpora or the installed Tailwind
 * change what is served, which is the same bargain every `gen:*:check` in this
 * repo already makes — and a Tailwind upgrade that changes which classes exist
 * is a thing to read, not a thing to absorb silently.
 */
export const EXPECTED_SERVED = 1459;

/** @returns {Map<string, string[]>} Corpus file name → its class lines. */
export function readCorpora(dir = corpusDir) {
    const byFile = new Map();
    for (const file of readdirSync(dir).filter(f => f.endsWith('.txt'))) {
        const lines = readFileSync(join(dir, file), 'utf8')
            .split('\n')
            .map(s => s.trim())
            .filter(s => s && !s.startsWith('#'));
        byFile.set(file, lines);
    }
    return byFile;
}

/**
 * Count served utilities and collect the ones nothing classified.
 *
 * @param corpora - Corpus file name → class lines.
 * @param isServed - Whether Tailwind emits CSS for a token.
 * @param classify - The runtime classifier under test.
 * @returns Counts plus the served-but-unclassified tokens.
 */
export function evaluate(corpora, isServed, classify) {
    const gaps = [];
    let served = 0;
    let classified = 0;
    for (const [file, lines] of corpora) {
        for (const token of lines) {
            if (!isServed(token)) continue;
            served++;
            if (classify(token)) classified++;
            else gaps.push({ token, file });
        }
    }
    return { served, classified, gaps };
}

/** @returns {(token: string) => boolean} A served-check backed by real Tailwind. */
async function tailwindOracle() {
    const require = createRequire(import.meta.url);
    // The package root, not `dist/` — `@import "tailwindcss"` resolves
    // `index.css` and the theme files relative to it.
    const base = dirname(require.resolve('tailwindcss/package.json'));
    const mod = await import(pathToFileURL(require.resolve('tailwindcss')).href);
    const compile = mod.compile ?? mod.default?.compile;
    const compiler = await compile('@import "tailwindcss";', {
        base,
        // Resolved through the module system rather than joined onto a
        // directory, the way this repo's other Tailwind-reading scripts do
        // (`check-var-hostile-keys.mjs`, `check-szcn-collision-blocklist.mjs`).
        // Tailwind only ever calls this with our own literal import today —
        // measured — but a hand-joined id is one upstream change away from
        // reading outside the package, and this runs in CI.
        loadStylesheet: async (id, from) => {
            const spec = id === 'tailwindcss' ? 'tailwindcss/index.css' : id;
            const p = require.resolve(spec, { paths: [from ?? base] });
            return { path: p, base: dirname(p), content: readFileSync(p, 'utf8') };
        },
    });
    // `build` is cumulative, so a candidate that changes the output is one the
    // previous call had not already served. Comparing against the running
    // output — not against the empty build — is what makes that true.
    let previous = compiler.build([]);
    return token => {
        const current = compiler.build([token]);
        const changed = current !== previous;
        previous = current;
        return changed;
    };
}

/**
 * Turn a measurement into an exit code and the lines to print.
 *
 * Separated from {@link main} so the decision — including the exit code, which
 * is the only part CI reads — is reachable from a test. A gate whose failure
 * path never runs under test can lose its `process.exitCode` and go on printing
 * the failure while reporting success.
 *
 * @param measurement - Counts and gaps from {@link evaluate}.
 * @param expectedServed - How many utilities the corpora should have served.
 * @returns The exit code, the normal output, and the error output.
 */
export function verdict({ served, classified, gaps }, expectedServed = EXPECTED_SERVED) {
    const pct = served === 0 ? 0 : (100 * classified) / served;
    const out = [
        `[check-classify-coverage] ${classified}/${served} served utilities classified (${pct.toFixed(1)}%).`,
    ];

    // Before the gaps, because a run that measured nothing HAS no gaps: read in
    // the other order, total blindness is indistinguishable from a clean pass.
    if (served !== expectedServed) {
        return {
            exitCode: 1,
            out,
            err: [
                `[check-classify-coverage] ${served} utilities were served, expected ${expectedServed}.`,
                'More means something new is being served; fewer means this run checked less than',
                'it should have. Either way the percentage above was not gated — do not read it',
                'as a pass.',
                'help: `git diff scripts/corpus/` and the installed tailwindcss version say which',
                'of the two moved. If the change is deliberate, set EXPECTED_SERVED in',
                'scripts/check-classify-coverage.mjs and say why in the commit.',
            ],
        };
    }

    if (gaps.length > 0) {
        return {
            exitCode: 1,
            out,
            err: [
                `[check-classify-coverage] ${gaps.length} served utilities are unclassified:`,
                ...gaps.map(({ token, file }) => `  ${token}  (${file})`),
                'Add the prefix to TAILWIND_ONLY_PREFIXES in scripts/gen-box-role-map.mjs, then',
                'run pnpm gen:box-role. If the utility is deliberately out of scope — a custom',
                'utility declaring several properties has no correct side — say so in the commit',
                'before silencing it here.',
            ],
        };
    }

    return { exitCode: 0, out, err: [] };
}

async function main() {
    const { classify } = await import('../packages/runtime/src/split-box.js');
    const { exitCode, out, err } = verdict(
        evaluate(readCorpora(), await tailwindOracle(), classify),
    );
    for (const line of out) console.log(line);
    for (const line of err) console.error(line);
    process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
