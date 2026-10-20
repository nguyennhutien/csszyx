#!/usr/bin/env node

/**
 * Generate the state-variant table from the Tailwind this repo pins.
 *
 * A key holding an object lowers to a variant: `{ hidden: { p: 4 } }` writes
 * `hidden:p-4`. Tailwind serves a bare variant for some HTML and ARIA states
 * (`checked:`, `disabled:`) and not for others (`hidden:`, `expanded:`), and
 * the class it does not serve styles nothing. `csszyx check` and the build
 * ask the project's own Tailwind (`unserved-variant`, ADR 0031 item 17); the
 * runtime cannot read the project's stylesheet, so it reads this table: every
 * ARIA state csszyx knows, the form its diagnostic takes (whether it is an
 * HTML attribute too), and which of them the pinned Tailwind serves bare. Any
 * other name is an open variant a project may define with `@custom-variant`,
 * and the runtime says nothing about it.
 *
 * Which names are served is measured, never written by hand: one probe per
 * name (`<name>:flex`), asked of the pinned Tailwind's design system through
 * the oracle every build uses. The multi-version gate
 * (`scripts/check-tailwind-versions.mjs`) asks every Tailwind v4 csszyx serves
 * the same question and holds the differences to its baseline.
 *
 * The output is `packages/compiler/src/state-variants.generated.ts`.
 *
 * Usage:
 *   node --import tsx/esm scripts/gen-state-variants.mjs           # write
 *   node --import tsx/esm scripts/gen-state-variants.mjs --check   # CI gate
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Format of the generated table. Bump it when its shape changes. */
export const STATE_VARIANT_FORMAT = 1;

/**
 * HTML boolean attributes a bare key may mean (ADR 0031 item 17: a name
 * written alone is the HTML attribute or a Tailwind variant; ARIA is written
 * under `aria`). The ones measured for the decision on Tailwind 4.3.3.
 */
export const HTML_STATE_ATTRIBUTES = [
    'checked',
    'default',
    'disabled',
    'hidden',
    'inert',
    'open',
    'readonly',
    'required',
    'selected',
];

/** A utility every Tailwind v4 serves, to ask whether a variant is served. */
export const PROBE_UTILITY = 'flex';

/**
 * The form `unserved-variant` gives each ARIA state: `attribute-or-aria` when
 * it is an HTML attribute too (`hidden`), `aria` otherwise (`expanded`). An
 * HTML attribute that is no ARIA state (`inert`, `open`) is no name of the
 * table: every Tailwind v4 serves it bare, and {@link assertHtmlOnlyServed}
 * holds the pin to that.
 *
 * @param {ReadonlySet<string>} ariaStates - The ARIA states `aria: { … }` takes bare (`ARIA_STATES`).
 * @param {readonly string[]} htmlAttributes - {@link HTML_STATE_ATTRIBUTES}.
 * @returns {Map<string, 'aria' | 'attribute-or-aria'>} Name to form, in name order.
 */
export function stateVariantForms(ariaStates, htmlAttributes) {
    const html = new Set(htmlAttributes);
    return new Map(
        [...ariaStates].sort().map(name => [name, html.has(name) ? 'attribute-or-aria' : 'aria']),
    );
}

/**
 * The HTML attributes that are no ARIA state, which the table leaves out.
 *
 * @param {ReadonlySet<string>} ariaStates - `ARIA_STATES`.
 * @param {readonly string[]} htmlAttributes - {@link HTML_STATE_ATTRIBUTES}.
 * @returns {string[]} The names, in name order.
 */
export function htmlOnlyStateNames(ariaStates, htmlAttributes) {
    return htmlAttributes.filter(name => !ariaStates.has(name)).sort();
}

/**
 * Throw unless a Tailwind serves every HTML attribute the table leaves out:
 * one it stopped serving needs a form, which is a decision for a person.
 *
 * @param {readonly string[]} htmlOnly - {@link htmlOnlyStateNames}.
 * @param {readonly string[]} served - The names the Tailwind serves bare.
 */
export function assertHtmlOnlyServed(htmlOnly, served) {
    const missing = htmlOnly.filter(name => !served.includes(name));
    if (missing.length > 0) {
        throw new Error(
            `tailwindcss serves no bare ${missing.map(name => `\`${name}\``).join(', ')} variant; ` +
                'give each a form in scripts/gen-state-variants.mjs and the unserved-variant registry entry',
        );
    }
}

/**
 * The names a Tailwind serves as a bare variant.
 *
 * @param {readonly string[]} names - The state names.
 * @param {(classes: string[]) => string[]} findDead - The design system's
 *        dead classes among those asked.
 * @returns {string[]} The served names, in the order given.
 */
export function servedStateVariants(names, findDead) {
    const dead = new Set(findDead(names.map(name => `${name}:${PROBE_UTILITY}`)));
    return names.filter(name => !dead.has(`${name}:${PROBE_UTILITY}`));
}

/**
 * Where a version's served state variants differ from the pin's.
 *
 * @param {readonly string[]} served - Served on the version.
 * @param {readonly string[]} pinned - Served on the pin (the table).
 * @param {readonly string[]} names - Every state name.
 * @returns {string[]} One line per differing name, in name order.
 */
export function stateVariantDifferences(served, pinned, names) {
    const here = new Set(served);
    const pin = new Set(pinned);
    return [...names]
        .sort()
        .filter(name => here.has(name) !== pin.has(name))
        .map(name =>
            pin.has(name)
                ? `${name}: served by the pin, not here`
                : `${name}: served here, not by the pin`,
        );
}

/**
 * Render the TypeScript module.
 *
 * @param {ReadonlyMap<string, string>} forms - Name to form.
 * @param {readonly string[]} served - The names the pin serves.
 * @param {string} tailwindVersion - The Tailwind that answered.
 * @returns {string} TypeScript source.
 */
export function renderStateVariants(forms, served, tailwindVersion) {
    const rows = [...forms].map(([name, form]) => `    ${name}: '${form}',`).join('\n');
    // One per line: the formatter leaves a list written that way alone.
    const list = served.map(name => `    '${name}',`).join('\n');
    return `// @generated by scripts/gen-state-variants.mjs from tailwindcss ${tailwindVersion}, the
// Tailwind this repo pins, and gated across Tailwind v4 versions in CI
// (scripts/check-tailwind-versions.mjs). The runtime's answer only: \`csszyx check\`
// and the build ask the project's own Tailwind (PROJECT-RULES §4).
// Do not edit by hand. Run \`pnpm gen:state-variants\` after a Tailwind bump.

/** Format of {@link STATE_VARIANT_FORMS} and {@link SERVED_STATE_VARIANTS}. */
export const STATE_VARIANT_FORMAT = ${STATE_VARIANT_FORMAT};

/** How \`unserved-variant\` words a state name: the ARIA state, or the attribute and the state. */
export type StateVariantForm = 'aria' | 'attribute-or-aria';

/**
 * Every ARIA state \`aria: { … }\` takes bare, with the form \`unserved-variant\`
 * names it in. An HTML attribute that is no ARIA state (\`inert\`, \`open\`) is
 * not listed: every Tailwind v4 serves it bare, and the generator fails when
 * the pin stops.
 */
export const STATE_VARIANT_FORMS: Readonly<Record<string, StateVariantForm>> = {
${rows}
};

/** The names among them the pinned Tailwind serves as a bare variant (\`checked:\`). */
export const SERVED_STATE_VARIANTS: readonly string[] = [
${list}
];
`;
}

/**
 * Measure the state variants the Tailwind a directory resolves serves.
 *
 * @param {object} options - What to measure.
 * @param {string} options.resolveFrom - Directory whose `node_modules` holds `tailwindcss`.
 * @param {ReadonlySet<string>} options.ariaStates - `ARIA_STATES`.
 * @returns {Promise<{ version: string, forms: Map<string, string>, served: string[] }>}
 *          The Tailwind version, the forms and the served names; throws when
 *          an HTML attribute the table leaves out is not served.
 */
export async function measureStateVariants({ resolveFrom, ariaStates }) {
    const { createEmittedClassOracle } = await import('@csszyx/tailwind-oracle');
    const oracle = await createEmittedClassOracle({
        resolveFrom,
        css: '@import "tailwindcss";',
        cssBase: resolveFrom,
    });
    if (!oracle.ok) throw new Error(`no Tailwind design system to ask: ${oracle.reason}`);
    if (oracle.findDead([PROBE_UTILITY]).length > 0) {
        throw new Error(`the probe utility \`${PROBE_UTILITY}\` is not served`);
    }
    const manifest = createRequire(path.join(resolveFrom, 'package.json')).resolve(
        'tailwindcss/package.json',
    );
    const { version } = JSON.parse(readFileSync(manifest, 'utf8'));
    const forms = stateVariantForms(ariaStates, HTML_STATE_ATTRIBUTES);
    const htmlOnly = htmlOnlyStateNames(ariaStates, HTML_STATE_ATTRIBUTES);
    assertHtmlOnlyServed(htmlOnly, servedStateVariants(htmlOnly, oracle.findDead));
    return { version, forms, served: servedStateVariants([...forms.keys()], oracle.findDead) };
}

/** Run the generator: write the table, or check it. */
async function main() {
    const repoRoot = path.resolve(import.meta.dirname, '..');
    const outPath = path.join(repoRoot, 'packages/compiler/src/state-variants.generated.ts');
    const { ARIA_STATES } = await import('../packages/compiler/src/transform-core.js');
    let measured;
    try {
        measured = await measureStateVariants({ resolveFrom: repoRoot, ariaStates: ARIA_STATES });
    } catch (error) {
        fail(error.message);
    }
    const generated = renderStateVariants(measured.forms, measured.served, measured.version);
    if (process.argv.includes('--check')) {
        if (readFileSync(outPath, 'utf8') !== generated) {
            fail(`${path.relative(repoRoot, outPath)} is stale. Run pnpm gen:state-variants.`);
        }
        return;
    }
    writeFileSync(outPath, generated);
    console.log(`[gen-state-variants] Wrote ${path.relative(repoRoot, outPath)}`);
}

/**
 * Print a failure and exit.
 *
 * @param {string} message - What went wrong.
 */
function fail(message) {
    console.error(`[gen-state-variants] ${message}`);
    process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
