/**
 * Third hybrid-mangle hazard: a stylesheet that matches class NAMES through an
 * attribute selector. Renaming the class breaks the match, so the rule stops
 * applying — silently, because the build is green and the CSS is intact.
 *
 * Matching follows Selectors Level 4. `^=`/`$=`/`*=` look at the whole class
 * attribute, a space-separated list, so a value with spaces spans several
 * classes; `~=` is word-equality and matches nothing when the value has a
 * space; `|=` is `v` or `v-…`. The check over-approximates on purpose — it
 * cannot know which class comes first on an element — because its output is
 * a warning, not a rewrite.
 */
import { describe, expect, it } from 'vitest';

import { collectMangleHybridHazards, mangleHybridHazardMessage } from '../src/unplugin.js';

const MAP = {
    'bg-tag-blue-bg': 'y4',
    'bg-tag-red-bg': 'y5',
    'text-tag-blue-fg': 'L2',
    'p-4': 'a',
    'md:p-4': 'b',
};
const NONE = new Set<string>();
const ALL = new Set(Object.keys(MAP));

/**
 * Run the collector with one selector.
 *
 * @param operator - Attribute operator.
 * @param value - Attribute value.
 * @param insensitive - Whether the selector carried the `i` flag.
 * @returns The selector hazards found.
 */
function matchesFor(operator: string, value: string, insensitive = false) {
    return collectMangleHybridHazards(MAP, ALL, NONE, [{ operator, value, insensitive }])
        .selectorMatches;
}

describe('attribute selectors against the mangle map', () => {
    it.each([
        ['*=', 'bg-tag', ['bg-tag-blue-bg', 'bg-tag-red-bg']],
        ['^=', 'bg-tag', ['bg-tag-blue-bg', 'bg-tag-red-bg']],
        ['$=', '-fg', ['text-tag-blue-fg']],
        ['~=', 'p-4', ['p-4']],
        ['=', 'p-4', ['p-4']],
        ['|=', 'p', ['p-4']],
        ['|=', 'p-4', ['p-4']],
    ])('%s %j names the classes it depends on', (operator, value, expected) => {
        expect(matchesFor(operator, value)).toEqual([
            {
                selector: `[class${operator}"${value}"]`,
                value,
                renamed: expected,
                matchedTokens: [],
            },
        ]);
    });

    it('spans several classes when the value contains spaces', () => {
        // `*= "blue-bg text"`: some class ends with `blue-bg`, the next starts with `text`.
        expect(matchesFor('*=', 'blue-bg text')[0]?.renamed).toEqual([
            'bg-tag-blue-bg',
            'text-tag-blue-fg',
        ]);
        // `~=` with a space can match nothing, so it is not a hazard.
        expect(matchesFor('~=', 'p-4 m-2')).toEqual([]);
    });

    it.each([
        // first segment must END a class, the last must EQUAL one
        ['$=', 'blue-bg p-4', ['bg-tag-blue-bg', 'p-4']],
        // first must EQUAL, the last is `v` or `v-…`
        ['|=', 'p-4 p', ['p-4']],
        // every segment must EQUAL a class
        ['=', 'p-4 md:p-4', ['md:p-4', 'p-4']],
        // first must EQUAL, the last must START a class
        ['^=', 'p-4 text', ['p-4', 'text-tag-blue-fg']],
        // a middle segment must EQUAL a class outright
        ['*=', 'x md:p-4 y', ['md:p-4']],
        // a leading or trailing space constrains nothing on that edge
        ['*=', ' bg-tag', ['bg-tag-blue-bg', 'bg-tag-red-bg']],
        ['*=', 'blue-bg ', ['bg-tag-blue-bg']],
    ])('%s %j with spaces follows the class list', (operator, value, expected) => {
        expect(matchesFor(operator, value)[0]?.renamed).toEqual(expected);
    });

    it('ignores an operator it does not know', () => {
        expect(matchesFor('??=', 'p-4')).toEqual([]);
    });

    it('lists hazards in byte order of their selector', () => {
        const hazards = collectMangleHybridHazards(MAP, ALL, NONE, [
            { operator: '~=', value: 'p-4', insensitive: false },
            { operator: '*=', value: 'bg-tag', insensitive: false },
            { operator: '$=', value: '-fg', insensitive: false },
        ]).selectorMatches;
        expect(hazards.map(hazard => hazard.selector)).toEqual([
            '[class$="-fg"]',
            '[class*="bg-tag"]',
            '[class~="p-4"]',
        ]);
    });

    it('folds ASCII case under the i flag', () => {
        expect(matchesFor('^=', 'BG-TAG', true)[0]?.renamed).toEqual([
            'bg-tag-blue-bg',
            'bg-tag-red-bg',
        ]);
        expect(matchesFor('^=', 'BG-TAG')).toEqual([]);
    });

    it('also reports tokens a selector would start matching', () => {
        // `[class^="y"]` in external CSS did not match before; now `y4`/`y5` do.
        const [hazard] = matchesFor('^=', 'y');
        expect(hazard?.renamed).toEqual([]);
        expect(hazard?.matchedTokens).toEqual(['y4', 'y5']);
    });

    it('stays silent when no class and no token is affected', () => {
        expect(matchesFor('*=', 'btn--icon')).toEqual([]);
    });
});

describe('the hazard message', () => {
    it('names the selector, the classes and a paste-ready manglePreserve', () => {
        const message = mangleHybridHazardMessage(
            collectMangleHybridHazards(MAP, ALL, NONE, [
                { operator: '*=', value: 'bg-tag', insensitive: false },
                { operator: '~=', value: 'p-4', insensitive: false },
            ]),
        );
        expect(message).toContain('[class*="bg-tag"]');
        expect(message).toContain('bg-tag-blue-bg');
        // Every renamed class starts with the value, so a prefix entry covers them.
        expect(message).toContain("manglePreserve: ['bg-tag*', 'p-4']");
        expect(message).toContain('mangleExclude');
    });

    it('lists exact names when no prefix covers them, and escapes quotes', () => {
        const message = mangleHybridHazardMessage(
            collectMangleHybridHazards({ ...MAP, "it's": 'c' }, ALL, NONE, [
                { operator: '$=', value: '-fg', insensitive: false },
                { operator: '*=', value: "it'", insensitive: false },
            ]),
        );
        expect(message).toContain("manglePreserve: ['text-tag-blue-fg', 'it\\'*']");
    });

    it('says when a selector would start matching tokens instead', () => {
        const message = mangleHybridHazardMessage(
            collectMangleHybridHazards(MAP, ALL, NONE, [
                { operator: '^=', value: 'y', insensitive: false },
            ]),
        );
        expect(message).toContain('would start matching mangled tokens');
        expect(message).toContain('[class^="y"] → y4, y5');
        // The remedy for a token the selector would catch is to keep the
        // allocator from producing it — the option the paragraph above
        // says cannot help with a renamed class is exactly the one here.
        expect(message.indexOf("mangleExclude: ['y4', 'y5']")).toBeGreaterThan(
            message.indexOf('would start matching mangled tokens'),
        );
        expect(message).toContain('data attribute');
        expect(message).not.toContain('manglePreserve');
    });

    it('still reports collisions and orphans the same way', () => {
        const message = mangleHybridHazardMessage(
            collectMangleHybridHazards(MAP, new Set(['p-4']), new Set(['y4'])),
        );
        expect(message).toContain('collide');
        expect(message).toContain('no emitted CSS rule');
        expect(message).not.toContain('manglePreserve');
    });

    // Every hazard kind carries its own fix. Listing all the findings and then
    // all the fixes let a reader attach the wrong one: the orphan remedy
    // ("those classes are csszyx-owned") landed straight after the selector
    // list, where it reads as a claim about the selector's classes.
    it('keeps each remedy with the finding it answers', () => {
        const message =
            mangleHybridHazardMessage(
                collectMangleHybridHazards(MAP, NONE, new Set(['y4']), [
                    { operator: '*=', value: 'bg-tag', insensitive: false },
                ]),
            ) ?? '';
        const orphanFinding = message.indexOf('no emitted CSS rule');
        const orphanRemedy = message.indexOf('csszyx-owned');
        const selectorFinding = message.indexOf('attribute selector(s) match class names');
        const selectorRemedy = message.indexOf('manglePreserve');
        expect(orphanFinding).toBeGreaterThanOrEqual(0);
        expect(orphanRemedy).toBeGreaterThan(orphanFinding);
        expect(selectorFinding).toBeGreaterThan(orphanRemedy);
        expect(selectorRemedy).toBeGreaterThan(selectorFinding);
    });

    // An orphan reported next to a collision used to lose its fix entirely:
    // the collision branch answered both, and only the collision was addressed.
    it('answers an orphan even when a collision is reported too', () => {
        const message =
            mangleHybridHazardMessage(
                collectMangleHybridHazards(MAP, new Set(['p-4']), new Set(['y4'])),
            ) ?? '';
        expect(message).toContain('csszyx-owned');
    });
});
