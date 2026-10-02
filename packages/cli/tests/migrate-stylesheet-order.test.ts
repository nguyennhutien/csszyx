import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Pins the codemod's copy of Tailwind's stylesheet order against Tailwind.
 *
 * Before 0.18, two keys of one group in one sz object both shipped their
 * class and the stylesheet decided which rendered. `migrate --keys-only`
 * keeps the property whose class the stylesheet puts later
 * (`packages/core/src/migrate/stylesheet_order.rs`), so that list is only as
 * right as this test makes it: the order Tailwind prints, and every class the
 * closed keys and their family flags emit.
 */
const REPO = resolve(import.meta.dirname, '../../..');

/**
 * The body of a Rust function or `const` in a file under the repository.
 *
 * @param file - Path under the repository root.
 * @param name - The function or const name.
 * @returns Its text up to the closing brace or bracket at column 0.
 */
function rustItem(file: string, name: string): string {
    const source = readFileSync(resolve(REPO, file), 'utf8');
    const start = source.search(new RegExp(`(fn|const) ${name}\\b`));
    expect(start).toBeGreaterThan(-1);
    return source.slice(start, source.slice(start).search(/\n[}\]]/) + start);
}

/**
 * A lookup function's arms, as the matched text and the string it returns.
 *
 * @param file - Path under the repository root.
 * @param name - The function name.
 * @returns `[pattern, result]` per `=> Some("…")` arm.
 */
function rustArms(file: string, name: string): Array<[string, string]> {
    // Line by line rather than one regex over the item: a leading-whitespace
    // run followed by a lazy capture is the quadratic shape the ReDoS lint
    // refuses.
    const arms: Array<[string, string]> = [];
    for (const line of rustItem(file, name).split('\n')) {
        const arrow = line.indexOf(' => Some("');
        if (arrow === -1) continue;
        const start = arrow + ' => Some("'.length;
        arms.push([line.slice(0, arrow).trim(), line.slice(start, line.indexOf('"', start))]);
    }
    return arms;
}

/**
 * The classes in the order Tailwind's stylesheet prints them.
 *
 * @param classes - Utility class names.
 * @returns Those Tailwind printed, sorted by where their rule starts.
 */
async function stylesheetOrder(classes: string[]): Promise<string[]> {
    // The repository's Tailwind v4, the one every other suite measures; this
    // package's own `tailwindcss` resolves to the v3 the init tests need.
    const require = createRequire(resolve(REPO, 'package.json'));
    const tailwind = dirname(require.resolve('tailwindcss/package.json'));
    expect(JSON.parse(readFileSync(resolve(tailwind, 'package.json'), 'utf8')).version).toMatch(
        /^4\./,
    );
    const { compile } = await import(resolve(tailwind, 'dist/lib.mjs'));
    const compiler = await compile('@import "tailwindcss/utilities";', {
        base: '/',
        loadStylesheet: async () => ({
            base: '/',
            content: readFileSync(resolve(tailwind, 'utilities.css'), 'utf8'),
        }),
    });
    const css: string = compiler.build(classes);
    return classes
        .map(name => [name, css.indexOf(`.${name} {`)] as const)
        .filter(([, at]) => at >= 0)
        .sort((a, b) => a[1] - b[1])
        .map(([name]) => name);
}

describe('the codemod reads the stylesheet order Tailwind prints', () => {
    const order = [
        ...rustItem('packages/core/src/migrate/stylesheet_order.rs', 'STYLESHEET_ORDER').matchAll(
            /"([^"]+)"/g,
        ),
    ].map(match => match[1] as string);
    const tables = 'packages/core/src/transform/generated/tables.rs';

    it('lists every class a closed key or a family flag emits', () => {
        const flagClass = new Map(
            rustArms(tables, 'boolean_class').map(([key, cls]) => [key.replaceAll('"', ''), cls]),
        );
        const familyFlags = rustArms(tables, 'global_keyword_groups')
            .flatMap(([, groups]) => groups.split(' '))
            .flatMap(key => flagClass.get(key) ?? []);
        const closed = rustArms(tables, 'closed_enum_class').map(([, cls]) => cls);
        expect(familyFlags).toEqual([
            'ordinal',
            'slashed-zero',
            'touch-pinch-zoom',
            'contain-layout',
            'contain-paint',
            'contain-style',
        ]);
        expect([...order].sort()).toEqual([...closed, ...familyFlags].sort());
    });

    it('is the order Tailwind puts them in', async () => {
        expect(await stylesheetOrder(order)).toEqual(order);
    });
});
