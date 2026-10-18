/**
 * Removed boolean sugar, reported where it is written.
 *
 * `{ underline: true }` was replaced by `{ decoration: 'underline' }`, and the
 * build lane emits no class for the old spelling — correctly, since there is
 * one canonical form per CSS property now. What it did not do is SAY so.
 *
 * The key sat in a gap between two diagnostics: the unknown-property pass skips
 * it because the removed-sugar table claims it as known, and the removed-key
 * pass skips it because that table's notes cover four mask keys and none of
 * these. So an author saw a style silently vanish, with nothing to search for.
 *
 * The runtime lane has warned about exactly this since the sugar was removed.
 * A statically extracted prop never reaches the runtime, so the lane that
 * COMPILES it is the only one that can tell the author, and it stayed quiet.
 */
import { describe, expect, it } from 'vitest';

import { ENGINES, type ParityEngine } from './engine-parity-harness.js';

/**
 * Compile one sz prop and return its diagnostics.
 *
 * @param engine - Engine entry under test.
 * @param prop - The sz prop source, without the braces.
 * @returns The diagnostic strings.
 */
function diagnose(engine: ParityEngine, prop: string): string[] {
    const source = `export const A = () => <div sz={{ ${prop} }} />;`;
    return (engine(source, '/p/App.tsx').diagnostics ?? []).map(String);
}

/**
 * Compile one sz prop and return the arguments of its `removed-key` issues.
 *
 * @param engine - Engine entry under test.
 * @param prop - The sz prop source, without the braces.
 * @returns The args of each `removed-key` issue.
 */
function removedKeys(engine: ParityEngine, prop: string): object[] {
    const source = `export const A = () => <div sz={{ ${prop} }} />;`;
    return (engine(source, '/p/App.tsx').issues ?? [])
        .filter(issue => issue.code === 'removed-key')
        .map(issue => issue.args);
}

describe.each(ENGINES)('removed boolean sugar at build time (%s)', (_name, engine) => {
    it('names the key, the canonical replacement, and where it is written', () => {
        const messages = diagnose(engine, 'underline: true');

        expect(messages).toHaveLength(1);
        expect(removedKeys(engine, 'underline: true')).toEqual([
            { form: 'sugar', key: 'underline', replacement: "decoration: 'underline'" },
        ]);
        expect(messages[0]).toContain('`underline` boolean sugar was removed');
        expect(messages[0]).toContain("{ decoration: 'underline' }");
        expect(messages[0]).toContain('[csszyx] removed-key: /p/App.tsx:1:');
    });

    it('reports a display shorthand with its own replacement', () => {
        const messages = diagnose(engine, 'flex: true');

        expect(messages).toHaveLength(1);
        expect(removedKeys(engine, 'flex: true')).toEqual([
            { form: 'sugar', key: 'flex', replacement: "display: 'flex'" },
        ]);
        expect(messages[0]).toContain("{ display: 'flex' }");
    });

    it('stays silent for the canonical spelling', () => {
        expect(diagnose(engine, "decoration: 'underline'")).toEqual([]);
    });

    it('stays silent for a numeric value on a key that also takes one', () => {
        // `flex: 1` is the flex shorthand, untouched by the sugar removal — the
        // report keys on the `true` form, not on the key.
        expect(diagnose(engine, 'flex: 1')).toEqual([]);
    });

    it('stays silent when the sugar is switched off', () => {
        // `false` emits nothing either way, so there is no vanished style to
        // explain and nothing to report.
        expect(diagnose(engine, 'underline: false')).toEqual([]);
    });

    it('reports sugar nested inside a variant', () => {
        const messages = diagnose(engine, 'hover: { italic: true }');

        expect(messages).toHaveLength(1);
        expect(removedKeys(engine, 'hover: { italic: true }')).toEqual([
            { form: 'sugar', key: 'italic', replacement: "fontStyle: 'italic'" },
        ]);
        expect(messages[0]).toContain("{ fontStyle: 'italic' }");
    });

    it('names the codemod, so the fix does not have to be typed by hand', () => {
        // 35 keys were removed at once. An author who wrote several is better
        // served by the tool that rewrites them all than by 35 messages each
        // quoting one replacement.
        expect(diagnose(engine, 'underline: true')[0]).toContain('csszyx migrate');
    });

    it('reports each removed key on its own, at its own position', () => {
        const source =
            'export const A = () => (\n' +
            '    <div sz={{ underline: true }}>\n' +
            '        <span sz={{ italic: true }} />\n' +
            '    </div>\n' +
            ');';
        const result = engine(source, '/p/App.tsx');
        const messages = (result.diagnostics ?? []).map(String);

        expect(messages).toHaveLength(2);
        expect(
            result.issues?.map(issue => [(issue.args as { key: string }).key, issue.line]),
        ).toEqual([
            ['underline', 2],
            ['italic', 3],
        ]);
        expect(
            messages.some(
                m =>
                    m.startsWith('[csszyx] removed-key: /p/App.tsx:2:') &&
                    m.includes('`underline`'),
            ),
        ).toBe(true);
        expect(
            messages.some(
                m => m.startsWith('[csszyx] removed-key: /p/App.tsx:3:') && m.includes('`italic`'),
            ),
        ).toBe(true);
    });

    it('keeps reporting the canonical replacement for a key that reads like a variant', () => {
        // `hidden` is also a Tailwind state name. The report has to come from
        // the removed-sugar table, not from guessing at the key's shape.
        expect(diagnose(engine, 'hidden: true')[0]).toContain("{ display: 'none' }");
    });
});
