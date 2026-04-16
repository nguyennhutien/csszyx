/**
 * docs-proptable-sync — CI gate for PropTable documentation accuracy.
 *
 * Every { sz, tw } row in the reference MDX files is extracted and verified:
 *   transform(eval(sz)).className === tw
 *
 * This ensures the TW class shown in the docs stays in sync with the actual
 * compiler output. When the compiler changes, this test fails → update docs.
 * When docs rows are added or changed, this test fails → fix the tw field.
 *
 * The test reads MDX files directly so no separate maintenance is needed —
 * the MDX rows ARE the source of truth.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_REF = join(__dirname, '../../../apps/docs/src/content/docs/docs/reference');

const MDX_FILES = [
    'layout.mdx',
    'spacing.mdx',
    'sizing.mdx',
    'typography.mdx',
    'backgrounds.mdx',
    'borders.mdx',
    'effects.mdx',
    'transforms.mdx',
    'transitions.mdx',
    'interactivity.mdx',
    'flex-grid.mdx',
    'misc.mdx',
];

/**
 *
 */
interface DocRow {
    sz: string; // raw JS expression string, e.g. "{ p: 4 }"
    tw: string; // expected TW class output
}

/**
 * Extract all { sz: "...", tw: "..." } rows from MDX content.
 * Handles both double-quoted and single-quoted tw values since some TW classes
 * contain double quotes (e.g. font-features-["liga"_1]) and need single-quote
 * wrapping in MDX.
 * @param content - Raw MDX file content
 * @returns Array of extracted sz/tw pairs
 */
function extractRows(content: string): DocRow[] {
    const rows: DocRow[] = [];
    // sz is always double-quoted; tw can be double- or single-quoted.
    const re = /\{\s*sz:\s*"((?:[^"\\]|\\.)*)"\s*,\s*tw:\s*(?:"([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
        rows.push({ sz: m[1], tw: m[2] ?? m[3] });
    }
    return rows;
}

/**
 * Evaluate a sz display string into a real sz object.
 * The MDX string uses \" for inner double quotes — unescape before eval.
 * e.g. "{ content: '\"\"' }" → { content: '""' }
 * @param raw - Raw escaped sz string from MDX (e.g. `{ p: 4 }`)
 * @returns Parsed sz object ready for transform()
 */
function evalSz(raw: string): Parameters<typeof transform>[0] {
    const unescaped = raw.replace(/\\"/g, '"');

    return new Function(`return ${unescaped}`)() as Parameters<typeof transform>[0];
}

for (const filename of MDX_FILES) {
    const content = readFileSync(join(DOCS_REF, filename), 'utf-8');
    const rows = extractRows(content);

    describe(`docs/reference/${filename} (${rows.length} rows)`, () => {
        for (const { sz, tw } of rows) {
            it(`${sz} → "${tw}"`, () => {
                const szObj = evalSz(sz);
                const result = transform(szObj).className;
                expect(result).toBe(tw);
            });
        }
    });
}
