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
 * scope by decision, not by omission:
 * `.agent/decisions/0021-atomic-only-class-vocabulary.md`.
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
 * Fewest served utilities the corpora may yield before the run is treated as
 * broken rather than clean. Without it this gate has the failure shape it
 * exists to catch: if the oracle stops answering — a Tailwind upgrade changing
 * `build`'s semantics, a corpus that failed to load — every candidate reads as
 * "not served", nothing is checked, and the gate reports success. 1459 today;
 * the floor sits below that so an edited corpus does not trip it.
 */
export const MIN_SERVED = 1400;

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
        loadStylesheet: async id => {
            const p = join(base, id === 'tailwindcss' ? 'index.css' : id);
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

async function main() {
    const { classify } = await import('../packages/runtime/src/split-box.js');
    const { served, classified, gaps } = evaluate(readCorpora(), await tailwindOracle(), classify);
    const pct = served === 0 ? 0 : (100 * classified) / served;
    console.log(
        `[check-classify-coverage] ${classified}/${served} served utilities classified (${pct.toFixed(1)}%).`,
    );

    if (served < MIN_SERVED) {
        console.error(
            `[check-classify-coverage] only ${served} utilities were served, below the floor of ${MIN_SERVED}.\n` +
                'The oracle stopped answering — this run checked nothing. Do not read it as a pass.',
        );
        process.exitCode = 1;
        return;
    }

    if (gaps.length > 0) {
        console.error(
            `[check-classify-coverage] ${gaps.length} served utilities are unclassified:`,
        );
        for (const { token, file } of gaps) console.error(`  ${token}  (${file})`);
        console.error(
            'Add the prefix to TAILWIND_ONLY_PREFIXES in scripts/gen-box-role-map.mjs, then\n' +
                'run pnpm gen:box-role. If the utility is deliberately out of scope, say so in\n' +
                '.agent/decisions/0021-atomic-only-class-vocabulary.md before silencing it here.',
        );
        process.exitCode = 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
