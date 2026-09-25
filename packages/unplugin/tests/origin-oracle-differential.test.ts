/**
 * The stylesheet reading that tells Tailwind's classes from a project's,
 * checked against a real CSS parser.
 *
 * `@csszyx/tailwind-oracle` reads selectors and removes `@utility`/`@apply`
 * with a small scanner of its own, because the CLI inlines it and ships no CSS
 * parser. A selector it misreads is a hook it misses, and a hook missed is a
 * class a merge can delete, so both readings are held to PostCSS here over
 * generated stylesheets: nesting, strings and comments holding braces and
 * dots, escapes, values that look like selectors.
 */
import postcss, { type ChildNode, type Root } from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { describe, expect, it } from 'vitest';

import { createRng } from '../../core/tests/helpers/sz-fuzz.js';
import {
    classesInSelectors,
    collectClassHooks,
    noClassHooks,
    stripCustomUtilities,
} from '../../tailwind-oracle/src/origin-oracle.js';

const CASES = 1500;

const CLASS_ATTRIBUTES = [
    '[class~="shadow-md"]',
    "[class*='sha' i]",
    '[class^=p-4]',
    '[ class |= "card" s ]',
    '[class="a b"]',
    '[class$="}"]',
];

const CLASSES = ['a', 'shadow-md', 'p-4', '_x', '-neg', 'tw\\:p-2', '\\31 m', 'card-2'];
const VALUES = [
    '.5rem',
    'url(a.b)',
    "url(it's.png)",
    'url(a{b}.png)',
    '"x.y { }"',
    "'}'",
    'var(--x)',
    'red',
    '1px solid .z',
];

/**
 * A random draw from a list.
 *
 * @param rng - Seeded source.
 * @param items - The list.
 * @returns One item.
 */
function pick<T>(rng: () => number, items: readonly T[]): T {
    return items[Math.floor(rng() * items.length)] as T;
}

/**
 * One selector, from classes, pseudo-classes and combinators.
 *
 * @param rng - Seeded source.
 * @returns Selector text.
 */
function selector(rng: () => number): string {
    const compound = () => {
        const parts = [`.${pick(rng, CLASSES)}`];
        if (rng() < 0.3) parts.push(`.${pick(rng, CLASSES)}`);
        if (rng() < 0.2) parts.push(':hover');
        if (rng() < 0.2) parts.push(`:is(.${pick(rng, CLASSES)}, .${pick(rng, CLASSES)})`);
        if (rng() < 0.15) parts.push('[data-x=".f { }"]');
        if (rng() < 0.15) parts.push(pick(rng, CLASS_ATTRIBUTES));
        return parts.join('');
    };
    const compounds = [compound()];
    if (rng() < 0.4) compounds.push(pick(rng, [' ', ' > ', ' + ']) + compound());
    const list = [compounds.join('')];
    if (rng() < 0.2) list.push(compound());
    return list.join(', ');
}

/**
 * A declaration block, sometimes with a nested rule or an `@apply`.
 *
 * @param rng - Seeded source.
 * @param depth - Nesting so far.
 * @returns Block text, braces included.
 */
function block(rng: () => number, depth: number): string {
    const body: string[] = [];
    const count = 1 + Math.floor(rng() * 3);
    for (let index = 0; index < count; index += 1) {
        const roll = rng();
        if (roll < 0.15) body.push(`@apply ${pick(rng, ['a', 'p-4', 'shadow-md'])} p-4;`);
        else if (roll < 0.3 && depth < 2)
            body.push(`&.${pick(rng, CLASSES)} ${block(rng, depth + 1)}`);
        else body.push(`color: ${pick(rng, VALUES)};`);
    }
    return `{ ${body.join(' ')} }`;
}

/**
 * One top-level statement.
 *
 * @param rng - Seeded source.
 * @returns Statement text.
 */
function statement(rng: () => number): string {
    const roll = rng();
    if (roll < 0.2) return `@utility ${pick(rng, ['reveal', 'tab-*'])} ${block(rng, 0)}`;
    if (roll < 0.3) return `@media (min-width: 40.5rem) { ${selector(rng)} ${block(rng, 1)} }`;
    if (roll < 0.38) return `/* .${pick(rng, CLASSES)} { } */`;
    if (roll < 0.45) return '@import "./x.css";';
    return `${selector(rng)} ${block(rng, 0)}`;
}

/**
 * A generated stylesheet, as the statements that make it up.
 *
 * @param rng - Seeded source.
 * @returns Statements, joined by newlines to form the stylesheet.
 */
function stylesheet(rng: () => number): string[] {
    return Array.from({ length: 1 + Math.floor(rng() * 5) }, () => statement(rng));
}

/**
 * Remove statements one at a time while the failure still holds.
 *
 * @param parts - The failing stylesheet's statements.
 * @param separator - What joins them.
 * @param fails - Whether a stylesheet still fails.
 * @returns The smallest failing stylesheet found.
 */
function shrink(parts: string[], separator: string, fails: (css: string) => boolean): string {
    let current = parts;
    for (let index = 0; index < current.length; ) {
        const smaller = current.filter((_, at) => at !== index);
        if (smaller.length > 0 && fails(smaller.join(separator))) current = smaller;
        else index += 1;
    }
    return current.join(separator);
}

/**
 * Every class a rule selects on, as PostCSS reads it.
 *
 * @param css - Stylesheet text.
 * @returns Class names, sorted.
 */
function postcssClasses(css: string): string[] {
    const classes: string[] = [];
    postcss.parse(css).walkRules(rule => {
        selectorParser(selectors => {
            selectors.walkClasses(node => {
                classes.push(node.value);
            });
        }).processSync(rule.selector);
    });
    return classes.sort();
}

/**
 * A stylesheet's structure, whitespace aside.
 *
 * @param nodes - Nodes to describe.
 * @returns Nested description.
 */
function shape(nodes: readonly ChildNode[]): unknown[] {
    return nodes.flatMap(node => {
        if (node.type === 'comment') return [['comment', node.text]];
        if (node.type === 'decl') return [['decl', node.prop, node.value]];
        if (node.type === 'rule') return [['rule', node.selector, shape(node.nodes)]];
        return [['at', node.name, node.params, shape(node.nodes ?? [])]];
    });
}

/**
 * PostCSS's reading of the stylesheet minus `@utility` and `@apply`.
 *
 * @param css - Stylesheet text.
 * @returns Its structure after the removal.
 */
function postcssStripped(css: string): unknown[] {
    const root: Root = postcss.parse(css);
    root.walkAtRules(rule => {
        if (rule.name === 'utility' || rule.name === 'apply') rule.remove();
    });
    return shape(root.nodes);
}

/**
 * Run a property over generated stylesheets and report the smallest failure.
 *
 * @param seed - Generator seed.
 * @param fails - Whether a stylesheet breaks the property.
 */
function holds(seed: number, fails: (css: string) => boolean): void {
    const rng = createRng(seed);
    for (let index = 0; index < CASES; index += 1) {
        const parts = stylesheet(rng);
        // Minified as often as not: a scanner that leans on line breaks to
        // recover would read the one-line form differently.
        const separator = rng() < 0.5 ? '' : '\n';
        if (fails(parts.join(separator))) {
            const smallest = shrink(parts, separator, fails);
            expect.fail(`seed ${seed}, case ${index}, smallest failing stylesheet:\n${smallest}`);
        }
    }
}

describe('reading the classes a stylesheet selects on', () => {
    it('agrees with PostCSS', () => {
        holds(0x5e1ec7, css => {
            const ours = classesInSelectors(css).sort();
            return JSON.stringify(ours) !== JSON.stringify(postcssClasses(css));
        });
    });
});

/**
 * Every attribute selector on `class`, as PostCSS reads it.
 *
 * @param css - Stylesheet text.
 * @returns Operator, value and case flag of each, sorted.
 */
function postcssClassAttributes(css: string): string[] {
    const found: string[] = [];
    postcss.parse(css).walkRules(rule => {
        selectorParser(selectors => {
            selectors.walkAttributes(node => {
                if (node.attribute !== 'class' || node.operator === undefined) return;
                found.push(JSON.stringify([node.operator, node.value, node.insensitive === true]));
            });
        }).processSync(rule.selector);
    });
    return found.sort();
}

describe('reading attribute selectors on class', () => {
    it('agrees with PostCSS', () => {
        holds(0xa77b, css => {
            const hooks = noClassHooks();
            collectClassHooks(css, hooks);
            const ours = hooks.attributes
                .map(matcher =>
                    JSON.stringify([matcher.operator, matcher.value, matcher.insensitive]),
                )
                .sort();
            return JSON.stringify(ours) !== JSON.stringify(postcssClassAttributes(css));
        });
    });
});

describe('reading a stylesheet minified', () => {
    it('finds the classes it finds with line breaks', () => {
        holds(0x71f1ed, css => {
            const lines = css.replace(/\n/g, '');
            return (
                JSON.stringify(classesInSelectors(css).sort()) !==
                JSON.stringify(classesInSelectors(lines).sort())
            );
        });
    });
});

describe('removing a stylesheet’s own utilities', () => {
    it('leaves what PostCSS leaves', () => {
        holds(0x57219, css => {
            const ours = shape(postcss.parse(stripCustomUtilities(css)).nodes);
            return JSON.stringify(ours) !== JSON.stringify(postcssStripped(css));
        });
    });

    it('is idempotent, and the identity on a stylesheet with nothing to remove', () => {
        holds(0x1de4, css => {
            const once = stripCustomUtilities(css);
            if (stripCustomUtilities(once) !== once) return true;
            const nothingToRemove = !/@(?:utility|apply)\b/.test(
                css.replace(/\/\*[\s\S]*?\*\//g, ''),
            );
            return nothingToRemove && once !== css;
        });
    });
});
