/**
 * Every sz key × every value shape, lowered by every lane.
 *
 * One case set, read by two gates: the differential test
 * (`sz-capability-differential.test.ts`) asks whether the lanes agree byte for
 * byte and whether the pinned Tailwind serves what they wrote, and the
 * multi-version gate (`scripts/check-tailwind-versions.mjs`) asks the same
 * classes of every Tailwind v4 csszyx serves. Both lower through here, so the
 * two cannot drift into measuring different cases.
 *
 * NOT a `.test.ts` file on purpose: vitest must not collect it as a suite, and
 * it imports nothing from vitest so a plain Node script can load it.
 *
 * @module
 */
import {
    __resetSzWarnDedupForTests,
    PROPERTY_MAP,
    transform,
} from '../../compiler/src/transform-core.js';

/** An sz object, as an author writes it. */
type SzObject = Record<string, unknown>;

/** The values every key is given at the top level of its sz object. */
const VALUE_SHAPES: ReadonlyArray<readonly [shape: string, value: number | string]> = [
    ['number', 4],
    ['negative-number', -2],
    ['half-step', 0.5],
    ['off-step', 1.3],
    ['negative-string', '-2'],
    ['fraction', '1/2'],
    ['negative-fraction', '-1/2'],
    ['length', '10px'],
    ['negative-length', '-10px'],
    ['auto', 'auto'],
    ['full', 'full'],
    ['none', 'none'],
    ['css-wide', 'inherit'],
    ['important', '4!'],
    ['negative-important', '-4!'],
    ['numeric-string', '4'],
    ['percent', '50%'],
    // A colour with its opacity after a slash, as Tailwind spells it.
    ['slash-opacity', 'red-500/50'],
    // A custom property, which lowers to Tailwind's `(--v)` shorthand.
    ['var', '--v'],
    // A space inside a value: one class, the space as `_`, never several.
    ['space', 'calc(1px + 2px)'],
];

/**
 * A value under a variant key: the lowering takes another path for it, and a
 * prefix that holds at the top level can be lost on the way.
 *
 * @param key - The sz key.
 * @returns `{ hover: { [key]: 4 } }`.
 */
function underVariant(key: string): SzObject {
    return { hover: { [key]: 4 } };
}

/**
 * A value under a parametric container, which takes a path of its own again.
 *
 * @param key - The sz key.
 * @returns `{ data: { 'state=open': { [key]: 4 } } }`.
 */
function underParametricContainer(key: string): SzObject {
    return { data: { 'state=open': { [key]: 4 } } };
}

/** The value shapes, each with the sz object it gives a key. */
export const SHAPES: ReadonlyArray<readonly [shape: string, sz: (key: string) => SzObject]> = [
    ...VALUE_SHAPES.map(
        ([shape, value]) => [shape, (key: string): SzObject => ({ [key]: value })] as const,
    ),
    ['hover', underVariant],
    ['data-container', underParametricContainer],
];

/** What one lane wrote for a case, and whether it reported anything. */
export interface LaneOutput {
    className: string;
    reported: boolean;
}

/** One case: a key and a shape, with what every lane wrote for it. */
export interface CapabilityCase {
    /** `key|shape`. */
    id: string;
    shape: string;
    runtime: LaneOutput;
    /** Each engine artifact by name, in the order given. */
    engines: ReadonlyArray<readonly [name: string, output: LaneOutput]>;
}

/** What an engine artifact returns, narrowed to what a case reads. */
interface EngineResult {
    code?: string;
    issues?: ReadonlyArray<{ line: number }>;
}

/** One engine artifact: source in, transformed module out. */
export type CapabilityEngine = (source: string, options?: { filename?: string }) => EngineResult;

/**
 * The runtime lowering of one case, its console warnings counted.
 *
 * @param sz - The sz object.
 * @returns What it wrote and whether it warned.
 */
export function runtimeCase(sz: SzObject): LaneOutput {
    __resetSzWarnDedupForTests();
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
    try {
        return { className: transform(sz as never).className, reported: warnings.length > 0 };
    } catch {
        return { className: '<throw>', reported: true };
    } finally {
        console.warn = original;
    }
}

/**
 * Every shape of one key on one engine artifact, in one module.
 *
 * Each element sits on a line of its own and carries its index, so a class
 * and an issue are attributed to the shape that produced it.
 *
 * @param engine - The artifact.
 * @param key - The sz key.
 * @returns One output per shape, in {@link SHAPES} order.
 */
export function engineCases(engine: CapabilityEngine, key: string): LaneOutput[] {
    const lines = SHAPES.map(
        ([, sz], index) => `<p data-i="${index}" sz={${JSON.stringify(sz(key))}} />`,
    );
    const source = `export const A = () => (<>\n${lines.join('\n')}\n</>);`;
    const result = engine(source, { filename: '/p/src/Capability.jsx' });
    const code = result.code ?? '';
    const reportedLines = new Set((result.issues ?? []).map(issue => issue.line));
    const elements = new Map(
        [...code.matchAll(/<p data-i="(\d+)"([^>]*)\/>/g)].map(match => [match[1], match[2]]),
    );
    return SHAPES.map((_, index) => ({
        className: /className="([^"]*)"/.exec(elements.get(String(index)) ?? '')?.[1] ?? '',
        reported: reportedLines.has(index + 2),
    }));
}

/**
 * Lower every key × shape on the runtime and on each engine artifact.
 *
 * One engine call per key renders all shapes as lines of one module, so the
 * whole set costs a few hundred engine calls.
 *
 * @param engines - The engine artifacts, by name.
 * @returns One case per key and shape, keys in `PROPERTY_MAP` order.
 */
export function lowerEveryCase(
    engines: ReadonlyArray<readonly [name: string, engine: CapabilityEngine]>,
): CapabilityCase[] {
    const keys = Object.keys(PROPERTY_MAP);
    const byEngine = engines.map(
        ([name, engine]) =>
            [name, new Map(keys.map(key => [key, engineCases(engine, key)]))] as const,
    );
    return keys.flatMap(key =>
        SHAPES.map(([shape, sz], index) => ({
            id: `${key}|${shape}`,
            shape,
            runtime: runtimeCase(sz(key)),
            engines: byEngine.map(
                ([name, byKey]) =>
                    [name, byKey.get(key)?.[index] ?? { className: '', reported: false }] as const,
            ),
        })),
    );
}

/**
 * The class tokens a lane output names; a throw names none.
 *
 * @param className - What one lane wrote.
 * @returns Its tokens.
 */
export function tokensOf(className: string): string[] {
    return className === '<throw>' ? [] : className.split(' ').filter(Boolean);
}
