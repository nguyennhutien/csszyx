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
        expect(
            mangleHybridHazardMessage(
                collectMangleHybridHazards(MAP, ALL, NONE, [
                    { operator: '*=', value: 'bg-tag', insensitive: false },
                    { operator: '~=', value: 'p-4', insensitive: false },
                ]),
            ),
        ).toEqual([
            '[csszyx] mangle-hybrid-hazard:\n' +
                '  Mangling broke 2 attribute selector(s) that match class names by text, such as `[class*="bg-tag"] → bg-tag-blue-bg, bg-tag-red-bg`; `[class~="p-4"] → p-4`, so those rules stop matching and the elements lose those styles.\n' +
                "  help: keep those classes readable with `production.manglePreserve: ['bg-tag*', 'p-4']`, or select on a data attribute, which mangling never changes.\n" +
                '  note: `production.mangleExclude` does not help here: it reserves token names and still lets the class be renamed.\n' +
                '  docs: https://csszyx.com/e/mangle-hybrid-hazard',
        ]);
    });

    it('lists exact names when no prefix covers them, and escapes quotes', () => {
        // `it's` is no utility of ALL, so an orphan record comes first.
        const [, record] = mangleHybridHazardMessage(
            collectMangleHybridHazards({ ...MAP, "it's": 'c' }, ALL, NONE, [
                { operator: '$=', value: '-fg', insensitive: false },
                { operator: '*=', value: "it'", insensitive: false },
            ]),
        );
        expect(record).toContain("manglePreserve: ['text-tag-blue-fg', 'it\\'*']");
    });

    it('collapses to one prefix when the only outliers carry a variant', () => {
        // Field report: a preserve list of three prefixes dropped 60 names and
        // left none behind, yet the message still enumerated every `bg-tag-*`
        // class individually — because four of them were `dark:bg-tag-*`, which
        // does not START with the value even though its utility does. The
        // preserve matcher has looked past a variant prefix since the bracket
        // scan landed, so the suggestion was recommending work already covered.
        const map = { ...MAP, 'dark:bg-tag-blue-bg': 'z1' };
        const [record] = mangleHybridHazardMessage(
            collectMangleHybridHazards(map, new Set(Object.keys(map)), NONE, [
                { operator: '*=', value: 'bg-tag', insensitive: false },
            ]),
        );
        expect(record).toContain("manglePreserve: ['bg-tag*']");
        expect(record).not.toContain("'dark:bg-tag-blue-bg'");
    });

    it('names at most three selectors, and counts them all', () => {
        const [record] = mangleHybridHazardMessage(
            collectMangleHybridHazards(MAP, ALL, NONE, [
                { operator: '*=', value: 'bg-tag', insensitive: false },
                { operator: '~=', value: 'p-4', insensitive: false },
                { operator: '$=', value: '-fg', insensitive: false },
                { operator: '*=', value: 'md:p', insensitive: false },
            ]),
        );
        expect(record).toContain('Mangling broke 4 attribute selector(s)');
        // In selector order; the fourth, `[class~="p-4"]`, is only counted.
        expect(record).toContain('`[class*="md:p"] → md:p-4`, so');
        expect(record).not.toContain('[class~="p-4"]');
    });

    it('says when a selector would start matching tokens instead', () => {
        expect(
            mangleHybridHazardMessage(
                collectMangleHybridHazards(MAP, ALL, NONE, [
                    { operator: '^=', value: 'y', insensitive: false },
                ]),
            ),
        ).toEqual([
            '[csszyx] mangle-hybrid-hazard:\n' +
                '  Mangling made 1 attribute selector(s) match the tokens it renamed classes to, such as `[class^="y"] → y4, y5`, so their rules style elements they were not written for.\n' +
                "  help: reserve those tokens with `production.mangleExclude: ['y4', 'y5']`, or select on a data attribute, which mangling never changes.\n" +
                '  note: a prefix or substring selector can match tokens a later build allocates too, so the data attribute is the lasting fix.\n' +
                '  docs: https://csszyx.com/e/mangle-hybrid-hazard',
        ]);
    });

    // Every hazard kind carries its own fix: a record per kind, in the order
    // collision, orphan, renamed selector, matched selector, so a remedy never
    // lands after another kind's finding.
    it('keeps each remedy with the finding it answers', () => {
        const records = mangleHybridHazardMessage(
            collectMangleHybridHazards(MAP, new Set(['p-4']), new Set(['y4']), [
                { operator: '*=', value: 'bg-tag', insensitive: false },
                { operator: '^=', value: 'y', insensitive: false },
            ]),
        );
        expect(records.map(record => record.split('\n')[1]?.slice(0, 23))).toEqual([
            '  Mangling renamed clas',
            '  Mangling renamed 4 cl',
            '  Mangling broke 1 attr',
            '  Mangling made 1 attri',
        ]);
    });
});
