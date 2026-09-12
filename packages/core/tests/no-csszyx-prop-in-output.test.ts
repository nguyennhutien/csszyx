/**
 * No csszyx authoring prop survives into the transformed output.
 *
 * `sz`, `szs`, `szsc` and `szRecover` are instructions to the compiler. Once a
 * file has been transformed, an element carrying one of them either has a
 * consumer that reads it or it does not — and when it does not, React spreads
 * it onto the DOM as `sz="[object Object]"` and no class is applied. Every
 * other harness in this directory checks what ONE object lowers to; this one
 * checks what a whole FILE emits, which is where the defects below live and
 * where none of the object-level suites can see.
 *
 * Two survivals are allowed, and both are measured rather than assumed:
 *
 * - `szsc` on a COMPONENT. The compiler rewrites a slot-map `szs` into the
 *   lowered `szsc` for the component to forward into its parts
 *   (`rewrite.rs`, the `szs_attributes` loop). A component is any element
 *   whose name does not start with a lowercase letter or `-`, which is the
 *   parser's own host test (`is_style_host_element_name`).
 * - `szRecover` on an element that also carries `data-sz-recovery-token`. The
 *   runtime reads the attribute back off the DOM and checks it against the
 *   mode encoded in the token (`packages/runtime/src/verify.ts`), so the pair
 *   is the tamper check and must reach the DOM together.
 *
 * Both engine artifacts are driven, and their answers are compared: a leak on
 * one lane and not the other would itself be a finding.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SzObject } from '../../compiler/src/transform-core.js';
import { ENGINES, type ParityEngine } from '../../compiler/tests/engine-parity-harness.js';
import { jsxAttributes } from '../../compiler/tests/jsx-attributes.js';
import {
    createRng,
    fuzzBudget,
    generateSzObject,
    loadSzPool,
    type SzPool,
    shrinkSzObject,
} from './helpers/sz-fuzz.js';

/** Props the compiler is supposed to consume. */
const AUTHORING_PROPS = ['sz', 'szs', 'szsc', 'szRecover'] as const;

/** One csszyx prop found on one element of the output. */
interface Leak {
    tag: string;
    prop: string;
}

/**
 * Whether the parser treats this tag as a DOM host element.
 *
 * Mirrors `is_style_host_element_name` in `parser.rs` rather than importing
 * it: the rule is one character wide and the point of a gate is to state the
 * contract it holds the engine to.
 *
 * @param tag The JSX tag name.
 * @returns True for `div`, `my-element`; false for `Card`, `Ui.Button`.
 */
function isHost(tag: string): boolean {
    const first = tag[0] ?? '';
    return first === '-' || (first >= 'a' && first <= 'z');
}

/**
 * Every csszyx prop still present in a transformed module, minus the two
 * allowed survivals.
 *
 * Reads the attributes off an AST rather than matching them. A regex over
 * `<tag ...>` stops at the first `>`, so a `>` inside an earlier attribute
 * value hides everything after it: `<div title={"a>b"} sz={{ p: 4 }} />` and
 * `<div onClick={() => x} sz={{ p: 4 }} />` both report no leak from a regex
 * and report one from the parser. A gate that misses in silence is worse than
 * no gate.
 *
 * @param code The transformed module.
 * @returns The offending props, in document order.
 */
function leaksIn(code: string): Leak[] {
    const attributes = jsxAttributes(code);
    const tokenBearing = new Set(
        attributes.filter(a => a.name === 'data-sz-recovery-token').map(a => a.tag),
    );
    const out: Leak[] = [];
    for (const { tag, name } of attributes) {
        if (!AUTHORING_PROPS.includes(name as (typeof AUTHORING_PROPS)[number])) continue;
        if (name === 'szsc' && !isHost(tag)) continue;
        if (name === 'szRecover' && tokenBearing.has(tag)) continue;
        out.push({ tag, prop: name });
    }
    return out;
}

/**
 * Renders one element for a probe source.
 *
 * @param tag The JSX tag.
 * @param prop Which authoring prop to set.
 * @param value The prop's object value.
 * @param extra Any further attributes, verbatim.
 * @returns One JSX element.
 */
function element(tag: string, prop: string, value: SzObject, extra = ''): string {
    // Each piece is checked in the role it plays, because the same character is
    // fine in one position and not in another: an angle bracket belongs in
    // `extra`, never in a tag or prop name, and a quote belongs inside the
    // serialised object, never around it.
    //
    // Serialising is what makes the object a JSX expression, and it is also
    // what keeps `@container` — the one key in the vocabulary that needs
    // quoting — from producing a source that does not parse. It is not a
    // sanitizer though: `JSON.stringify` escapes for JSON, not for a
    // JavaScript source, and it leaves `</script>` and the line separators
    // alone. Hence the checks.
    assertName(tag);
    assertName(prop);
    assertNoBreakout(extra);
    const serialised = escapeUnsafeChars(JSON.stringify(value));
    return `<${tag} ${prop}={${serialised}}${extra} />`;
}

/** A JSX tag or attribute name: letters, digits, dot, dash. Nothing else. */
const NAME = /^[a-z][a-z0-9.-]*$/i;

/**
 * Escapes what `JSON.stringify` leaves dangerous when its output is spliced
 * into JavaScript source.
 *
 * `JSON.stringify` escapes for JSON, not for a program: it passes `<`, `>` and
 * the U+2028/U+2029 line separators through untouched, so a value containing
 * `</script>` breaks out of a script tag and a raw separator ends the line for
 * a parser. This is the escape CodeQL's own `js/bad-code-sanitization` help
 * prescribes, character for character, so the barrier is the recognised one
 * rather than a hand-rolled equivalent.
 *
 * The result is the same value: `"<"` reads back as `<`, so a probe
 * source means exactly what the object it came from meant.
 */
const UNSAFE_IN_SOURCE: Readonly<Record<string, string>> = {
    '<': '\\u003C',
    '>': '\\u003E',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
};

/**
 * Makes a JSON string safe to splice into JavaScript source.
 *
 * The set is the measured one rather than the illustrative one. CodeQL's help
 * for this rule lists the control characters too, but none of them can reach
 * here: `JSON.stringify` escapes every code point below U+0020, so the only
 * raw control character it ever emits is U+007F, which is not a line
 * terminator and not a delimiter. Sweeping the whole BMP through
 * `JSON.stringify` leaves exactly `<`, `>`, U+2028 and U+2029 raw and
 * meaningful to a parser — and a narrower class is also what keeps this
 * readable to the repository's own lint rules, which reject both `[\b]` and
 * `[\u0008]` inside a character class.
 *
 * `/` is deliberately absent, as it is from CodeQL's own regex: it is harmless
 * on its own, and the `</script>` case it belongs to is already closed by
 * escaping `<`.
 *
 * @param json Output of `JSON.stringify`.
 * @returns The same value, with the characters a JS parser reacts to escaped.
 */
function escapeUnsafeChars(json: string): string {
    return json.replace(/[<>\u2028\u2029]/g, character => UNSAFE_IN_SOURCE[character] as string);
}

/**
 * Characters that would end the current construct early wherever they appear.
 *
 * `SEP` is a real line terminator to a JavaScript parser, so a raw one splices
 * a source into two — which is the half of this that `JSON.stringify` does not
 * cover, along with `</script>`.
 *
 * A probe module is only ever built from this file's own tables and from the
 * generated `sz` vocabulary: 298 keys, of which one needs quoting, and no
 * documented value carries a backtick, an angle bracket or a line break. These
 * checks are here so that stays measured rather than assumed — a fixture that
 * grows such a value fails loudly instead of producing a module whose meaning
 * is not the object it came from.
 */
const BREAKOUT = /[\n\r<>`\u2028\u2029]|\$\{/;

/**
 * Rejects a tag or attribute name that is not a plain identifier.
 *
 * @param name The name to check.
 * @throws When the name could not appear literally in JSX.
 */
function assertName(name: string): void {
    if (!NAME.test(name)) {
        throw new Error(`probe source name is not a plain identifier: ${JSON.stringify(name)}`);
    }
}

/**
 * Rejects a fragment that would break out of the position it is spliced into.
 *
 * @param fragment One piece of a probe source.
 * @throws When the fragment carries a construct-ending character.
 */
function assertNoBreakout(fragment: string): void {
    if (BREAKOUT.test(fragment)) {
        throw new Error(`probe source fragment is not safe to splice: ${JSON.stringify(fragment)}`);
    }
}

/**
 * Wraps elements in a module so each is its own component.
 *
 * @param elements JSX elements, one per component.
 * @returns A module source.
 */
function moduleOf(elements: readonly string[]): string {
    // The comment that stood here claimed every element came from `element`
    // above and was therefore already checked. That was not true: three of the
    // recorded leaks pass a literal, because they need bare slot keys that
    // `JSON.stringify` cannot produce. So the shape is checked here, where the
    // splice happens, rather than assumed from where the caller usually is.
    for (const el of elements) assertElement(el);
    return elements.map((el, i) => `export const C${i} = () => ${el};`).join('\n');
}

/**
 * A single self-closing JSX element on one line — what every caller passes and
 * the only shape the module template is written for.
 */
const ELEMENT = /^<[a-z][\w.-]*\s[^\n\r\u2028\u2029]*\/>$/i;

/**
 * Rejects an element that would not sit correctly in the module template.
 *
 * @param el One JSX element.
 * @throws When it is not a single self-closing element on one line.
 */
function assertElement(el: string): void {
    if (!ELEMENT.test(el)) {
        throw new Error(`probe element is not a single self-closing tag: ${JSON.stringify(el)}`);
    }
}

/**
 * Defects this gate has found and that are recorded rather than fixed here.
 * The same idiom as `sz-known-defects.ts`: a recorded case that stops leaking
 * fails the suite as loudly as a new one that starts, so the list can only
 * shrink and can never quietly hide a regression.
 *
 * Each `source` must leak on BOTH engines today. `why` names the code, not a
 * theory.
 */
const KNOWN_LEAKS: readonly { name: string; source: string; why: string }[] = [
    {
        name: 'szs on a host element is left in place',
        source: moduleOf(['<div szs={{ root: { p: 4 } }} />']),
        why:
            '`parser.rs` deliberately leaves it unchanged and records a diagnostic: "szs has no ' +
            'effect on a host element". A diagnosed leak is still a leak — the attribute reaches the ' +
            'DOM as `szs="[object Object]"`.',
    },
    {
        name: 'szRecover with an unknown mode keeps the attribute and drops the token',
        source: `export const C0 = () => <div sz={{"p":4}} szRecover="strict" />;`,
        why:
            'The compiler diagnoses the unknown mode and skips token emission, but leaves the ' +
            'attribute — so it reaches the DOM with nothing for `verifyRecoveryToken` to pair it with.',
    },
    {
        name: 'szs with quoted slot keys is not read, and stays on the component',
        source: moduleOf([element('Card', 'szs', { root: { p: 4 } })]),
        why:
            'The parser reads `{ root: { p: 4 } }` but not `{"root":{"p":4}}` — the same map with ' +
            'its keys quoted — and reports "a slot value could not be read at build time", which ' +
            'names the wrong thing: the value is static, the key spelling is what it does not ' +
            'handle. `sz` accepts quoted keys on the same engine. Quoted keys are a legitimate ' +
            'authoring form (a formatter may emit them; `@container`-style keys require them), ' +
            'and the component then receives a raw slot map it has no reader for.',
    },
    {
        name: 'a hand-written szsc on a host element has no consumer and survives',
        source: moduleOf([element('div', 'szsc', { root: 'p-4' } as unknown as SzObject)]),
        why:
            '`szsc` is compiler output meant for a component. Nothing rewrites or strips it on a ' +
            'host, so it passes through untouched.',
    },
];

/** Tags to mix into generated files: two hosts, one component, one member. */
const TAGS = ['div', 'span', 'Card', 'Ui.Box'] as const;

/** Variants the generator may wrap keys in. Plain forms only. */
const VARIANTS = ['hover', 'focus', 'md', 'lg', 'dark'] as const;

describe('no csszyx authoring prop survives into the output', () => {
    let pool: SzPool;

    beforeAll(() => {
        pool = loadSzPool(VARIANTS);
        // Composition invents pairs the engine is right to warn about.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    /**
     * Draws a multi-element module. Objects that lower to nothing are drawn
     * like any other: they used to be filtered out while they were a recorded
     * defect, and now they are the shape most worth mixing in.
     *
     * @param rng Seeded generator.
     * @returns A module and the objects behind its elements.
     */
    function drawModule(rng: () => number): { source: string; objects: SzObject[] } {
        const objects: SzObject[] = [];
        const elements: string[] = [];
        const count = 2 + Math.floor(rng() * 3);
        while (elements.length < count) {
            const sz = generateSzObject(rng, pool, { maxKeys: 3, maxVariantDepth: 2 });
            const tag = TAGS[Math.floor(rng() * TAGS.length)] as string;
            objects.push(sz);
            elements.push(element(tag, 'sz', sz));
        }
        return { source: moduleOf(elements), objects };
    }

    describe.each(ENGINES)('%s', (_lane, engine: ParityEngine) => {
        it('hand-picked valid shapes leave nothing behind', () => {
            const sources = [
                moduleOf([element('div', 'sz', { p: 4 })]),
                moduleOf([element('Card', 'sz', { p: 4, hover: { bg: 'blue-500' } })]),
                moduleOf(["<Card szs={{ root: { p: 4 }, title: { weight: 'bold' } }} />"]),
                moduleOf([element('div', 'sz', { p: 4 }, ' szRecover="csr"')]),
                moduleOf([element('Card', 'sz', { p: 4 }, ' szRecover="dev-only"')]),
                moduleOf([element('div', 'sz', { p: 4 }), '<Card szs={{ root: { m: 2 } }} />']),
                // Zero-class shapes. `false` turns a key off and a variant block can
                // be left empty, so both are ordinary authoring, and the sibling
                // is there because each once aborted the whole file — the sibling
                // came out raw too, and that is what this gate was written for.
                moduleOf([element('div', 'sz', {}), element('div', 'sz', { p: 4 })]),
                moduleOf([
                    element('div', 'sz', { truncate: false }),
                    element('div', 'sz', { p: 4 }),
                ]),
                moduleOf([
                    element('div', 'sz', { hover: {} }),
                    element('Card', 'sz', { bg: 'blue-500' }),
                ]),
                // Two `sz` on one element, in every lane the rewrite has. Each
                // used to abort the whole file; now they compose as one array
                // and the sibling transforms.
                moduleOf(['<div sz={{ p: 4 }} sz={{ p: 2 }} />', element('div', 'sz', { m: 2 })]),
                moduleOf([
                    '<div sz={[a && { p: 2 }]} sz={[{ m: 2 }]} />',
                    element('div', 'sz', { m: 2 }),
                ]),
                moduleOf([
                    '<div sz={a ? { p: 4 } : { p: 2 }} sz={{ m: 2 }} />',
                    element('div', 'sz', { m: 2 }),
                ]),
                moduleOf(['<div sz={a} sz={b} />', element('div', 'sz', { m: 2 })]),
                moduleOf(['<div className="block" sz={{ p: 4 }} id="x" sz={{ p: 2 }} />']),
            ];
            for (const source of sources) {
                const code = engine(source, 'probe.tsx').code ?? '';
                expect(leaksIn(code), `source:\n${source}\noutput:\n${code}`).toEqual([]);
            }
        });

        it('generated multi-element files leave nothing behind', () => {
            const { seed, cases } = fuzzBudget(300);
            const rng = createRng(seed);
            const failures: string[] = [];

            for (let index = 0; index < cases; index += 1) {
                const { source, objects } = drawModule(rng);
                const code = engine(source, 'probe.tsx').code ?? '';
                const leaks = leaksIn(code);
                if (leaks.length === 0) continue;

                // Shrink to the smallest object set that still leaks, so the
                // report names the element rather than a five-element file.
                const stillLeaks = (candidate: SzObject): boolean =>
                    leaksIn(
                        engine(moduleOf([element('div', 'sz', candidate)]), 'probe.tsx').code ?? '',
                    ).length > 0;
                const culprit = objects.find(stillLeaks);
                const minimal = culprit === undefined ? null : shrinkSzObject(culprit, stillLeaks);
                const leakList = leaks.map(l => `${l.prop} on <${l.tag}>`).join(', ');
                failures.push(
                    `  seed=${seed} case=${index}\n` +
                        `      leaks   = ${leakList}\n` +
                        `      culprit = ${minimal === null ? '(none reproduces alone)' : JSON.stringify(minimal)}`,
                );
                if (failures.length >= 5) break;
            }

            expect(
                failures,
                `${failures.length} generated file(s) left a csszyx prop in the output. ` +
                    `Replay with SZ_FUZZ_SEED=${seed} SZ_FUZZ_CASES=${cases}:\n${failures.join('\n')}`,
            ).toEqual([]);
        });

        it('every recorded leak still leaks', () => {
            // The list can only shrink. A source that comes back clean has been
            // fixed, and its entry must go — with the pre-filter in
            // `drawModule` reconsidered at the same time.
            const fixed = KNOWN_LEAKS.filter(
                k => leaksIn(engine(k.source, 'probe.tsx').code ?? '').length === 0,
            ).map(k => k.name);
            expect(
                fixed,
                `${fixed.length} recorded leak(s) no longer leak — remove them from KNOWN_LEAKS`,
            ).toEqual([]);
        });
    });

    it('finds a prop hidden behind an angle bracket in an earlier value', () => {
        // The reader is tested directly rather than through an engine, because
        // the engine handles these shapes correctly — it is the READER that a
        // regex gets wrong. Matching `<tag ...>` stops at the `>` inside the
        // earlier value, so everything after it goes unseen and the suite would
        // report a clean file. These two fail that way and pass on an AST.
        expect(leaksIn('const A = () => <div title={"a>b"} sz={{"p":4}} />;')).toEqual([
            { tag: 'div', prop: 'sz' },
        ]);
        expect(leaksIn('const A = () => <div onClick={() => x} szs={{"r":{}}} />;')).toEqual([
            { tag: 'div', prop: 'szs' },
        ]);
    });

    it('both engine artifacts agree on what leaks', () => {
        // A recorded defect present on one lane and absent on the other is a
        // divergence between the two artifacts of one engine, which is its
        // own bug regardless of the defect.
        for (const known of KNOWN_LEAKS) {
            const answers = ENGINES.map(
                ([lane, engine]) =>
                    [lane, leaksIn(engine(known.source, 'probe.tsx').code ?? '')] as const,
            );
            const shapes = new Set(answers.map(([, leaks]) => JSON.stringify(leaks)));
            const summary = answers.map(([l, k]) => `${l}=${JSON.stringify(k)}`).join(' vs ');
            expect(shapes.size, `${known.name}: ${summary}`).toBe(1);
        }
    });
});
