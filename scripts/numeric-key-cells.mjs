/**
 * Check the four numeric-key tables against one Tailwind (ADR 0037).
 *
 * `sz-key-tables.ts` places a key by comparing Tailwind's bare class for a
 * number with its bracket class for the same number. The tables are written
 * by hand, so this asks a design system whether each listed key still sits in
 * its cell:
 *
 * - `DECIMAL_BRACKET_KEYS`: `x-4` and `x-[4]` write the same declarations, and
 *   `x-1.5` is dead while `x-[1.5]` is not;
 * - `NUMBER_BRACKET_KEYS`: `x-4` is dead and `x-[4]` is not;
 * - `FACTOR_STRING_KEYS`: `x-4` and `x-[4]` both write CSS, and not the same.
 *
 * `CLAMPED_FACTOR_KEYS` must be factor keys; whether CSS clamps them is a fact
 * about CSS, not Tailwind, and is not asked here.
 *
 * Cost: four `cssFor` classes per listed key, one batch; n = 36 keys today.
 * Used by `packages/tailwind-oracle/tests/numeric-key-cells.test.ts` on the
 * pin and by `check-tailwind-versions.mjs` (`cells`) on every version.
 */

/** `@property` descriptors, which say nothing about what a class sets. */
const DESCRIPTORS = new Set(['syntax', 'inherits', 'initial-value']);

/**
 * The declarations a class's CSS sets, in order, descriptors left out.
 *
 * @param {string | null} css - Tailwind's CSS for one class.
 * @returns {string} One `property:value` per line, or '' for none.
 */
function declarationsOf(css) {
    if (!css) return '';
    const found = [];
    for (const match of css.matchAll(/([-a-z]+)\s*:\s*([^;{}]+);/g)) {
        if (!DESCRIPTORS.has(match[1])) found.push(`${match[1]}:${match[2].trim()}`);
    }
    return found.join('\n');
}

/**
 * Where a listed key does not sit in the cell its table puts it in.
 *
 * @param {{
 *     decimalBracket: ReadonlySet<string>,
 *     numberBracket: ReadonlySet<string>,
 *     factorString: ReadonlySet<string>,
 *     clampedFactor: ReadonlySet<string>,
 * }} tables - The four tables.
 * @param {Readonly<Record<string, string>>} propertyMap - sz key to class prefix.
 * @param {(classes: string[]) => Array<string | null>} cssFor - One design system's CSS.
 * @returns {string[]} One line per key out of place, sorted.
 */
export function numericKeyCellFindings(tables, propertyMap, cssFor) {
    const keys = [...tables.decimalBracket, ...tables.numberBracket, ...tables.factorString];
    const classes = keys.flatMap(key => {
        const prefix = propertyMap[key];
        return [`${prefix}-4`, `${prefix}-[4]`, `${prefix}-1.5`, `${prefix}-[1.5]`];
    });
    const css = cssFor(classes).map(declarationsOf);
    const findings = [];
    keys.forEach((key, index) => {
        const [bare, bracket, bareDecimal, bracketDecimal] = css.slice(index * 4, index * 4 + 4);
        // A utility this Tailwind does not have (`zoom`, `tab` before 4.3)
        // writes nothing in any form: no cell to be in, and the `dead` list
        // already names every case of it.
        if (bare + bracket + bareDecimal + bracketDecimal === '') return;
        if (tables.decimalBracket.has(key)) {
            if (bare === '' || bare !== bracket)
                findings.push(`${key}: bare and bracket integers differ`);
            if (bareDecimal !== '' || bracketDecimal === '')
                findings.push(`${key}: a decimal does not need the bracket`);
        }
        if (tables.numberBracket.has(key) && (bare !== '' || bracket === '')) {
            findings.push(`${key}: the bare number is not dead`);
        }
        if (tables.factorString.has(key) && (bare === '' || bracket === '' || bare === bracket)) {
            findings.push(`${key}: bare and bracket do not mean two things`);
        }
    });
    for (const key of tables.clampedFactor) {
        if (!tables.factorString.has(key)) findings.push(`${key}: clamped but not a factor key`);
    }
    return findings.sort();
}
