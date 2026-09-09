/**
 * Every key emits inside its own namespace.
 *
 * `PROPERTY_MAP` says which Tailwind namespace a key owns — `maxW` owns
 * `max-w`, `p` owns `p`. This file asserts the consequence nobody had written
 * down: whatever value that key is given, the classes it emits stay in that
 * namespace.
 *
 * The invariant is worth more than the sum of the cases it covers, because it
 * holds for values nobody enumerated. A key that leaves its namespace for one
 * special value cannot be reported by `csszyx check`, which finds classes that
 * style nothing: the special case turns an unrecognised value into a class that
 * styles something, and the gate built to catch it sees a working class.
 *
 * That is not hypothetical. `{ maxW: 'container' }` lowered to the `container`
 * component for three months. It set `width` from a `max-width` key, its effect
 * depended on whether a sibling `w` was present, and the oracle could not see
 * it. No example-based test caught it because the value lived in a note column
 * of the snippets rather than a spec row, so no generated fixture covered it.
 *
 * Both engines are checked. An invariant that holds on one lane and not the
 * other is the shape of divergence this repo keeps producing.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { PROPERTY_MAP, transform } from '../../compiler/src/transform-core.js';
import { init, transform_sz } from '../pkg-node/csszyx_core.js';
import { loadSzPool, type SzPool } from './helpers/sz-fuzz.js';

/**
 * Keys whose value IS the class name, because Tailwind gives them no prefix:
 * `display: 'flex'` is `flex`, not `display-flex`.
 *
 * This is not a list of exceptions invented for this test. It is the set the
 * compiler already names in `BOOLEAN_SHORTHANDS`' own comment — the keys whose
 * value-alias sugar was removed — and measuring the emitted classes reproduces
 * it exactly, all eight and nothing else.
 *
 * A key joins this list only when Tailwind itself has no prefix for it. Adding
 * one to silence a failure would remove the only check that a key stays where
 * `PROPERTY_MAP` says it lives.
 */
const VALUE_ALIAS_KEYS: ReadonlySet<string> = new Set([
    'decoration',
    'display',
    'fontSmoothing',
    'fontStyle',
    'isolation',
    'position',
    'textTransform',
    'visibility',
]);

/**
 * Values that appear in no snippet, probed against every key.
 *
 * A special case hides where no fixture looks, so the fixture cases alone
 * cannot find one. `container` and `prose` are here because they name real
 * Tailwind components and so are the values most likely to tempt one.
 */
const UNDOCUMENTED_PROBES: readonly string[] = [
    'container',
    'prose',
    'screen',
    'none',
    'auto',
    'full',
    'zzqx',
];

// The lowering entry points, by lane. A line comment rather than a JSDoc
// block: the jsdoc rule reads the arrow signature in the type annotation as a
// function needing @param/@returns, and documenting a lane table that way says
// nothing.
const ENGINES: readonly (readonly [string, (sz: Record<string, unknown>) => string])[] = [
    ['ts', sz => transform(sz).className],
    ['rust', sz => transform_sz(sz)],
];

/**
 * The first `-`-separated segment, ignoring a leading negative sign.
 *
 * Segment-level rather than whole-prefix on purpose: `maskPos` owns
 * `mask-position` and legitimately emits `mask-bottom`, because Tailwind's mask
 * utilities share one `mask-` family. Requiring the full prefix would reject
 * five real keys; requiring the first segment accepts all of them and still
 * rejects a class from an unrelated family.
 *
 * @param className A single class token or a namespace prefix.
 * @returns Its first segment.
 */
function firstSegment(className: string): string {
    return className.replace(/^-/, '').split('-')[0] as string;
}

/**
 * Whether one emitted token belongs to the namespace a key owns.
 *
 * @param token One emitted class, without its variant prefix.
 * @param prefix The key's `PROPERTY_MAP` entry.
 * @returns True when the token stays in that namespace.
 */
function inNamespace(token: string, prefix: string): boolean {
    // An arbitrary property carries the CSS property itself:
    // `{ animationDelay: 'zzqx' }` emits `[animation-delay:zzqx]`. It names its
    // own namespace, so read it from inside the brackets.
    const arbitraryProperty = /^\[([^:]+):/.exec(token);
    if (arbitraryProperty !== null) {
        return firstSegment(arbitraryProperty[1] as string) === firstSegment(prefix);
    }
    return firstSegment(token) === firstSegment(prefix);
}

/** One `[key, value]` probe and the namespace its key owns. */
interface Probe {
    key: string;
    value: unknown;
    prefix: string;
}

describe('every key emits inside its own namespace', () => {
    let documented: Probe[];
    let undocumented: Probe[];

    beforeAll(async () => {
        await init();
        // Composition and probing invent value/key pairs nobody would author,
        // and the engine is right to warn about them.
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const pool: SzPool = loadSzPool([]);
        documented = pool.cases
            .filter(entry => PROPERTY_MAP[entry.key] !== undefined)
            .filter(entry => !VALUE_ALIAS_KEYS.has(entry.key))
            .map(entry => ({
                key: entry.key,
                value: entry.value,
                prefix: PROPERTY_MAP[entry.key] as string,
            }));

        undocumented = Object.keys(PROPERTY_MAP)
            .filter(key => !VALUE_ALIAS_KEYS.has(key))
            .flatMap(key =>
                UNDOCUMENTED_PROBES.map(value => ({
                    key,
                    value,
                    prefix: PROPERTY_MAP[key] as string,
                })),
            );
    });

    /**
     * Runs one probe set through one engine and returns the escapes.
     *
     * @param probes The key/value pairs to lower.
     * @param lower The engine entry point.
     * @returns One line per token that left its key's namespace.
     */
    function escapes(probes: readonly Probe[], lower: (sz: Record<string, unknown>) => string) {
        const out: string[] = [];
        for (const { key, value, prefix } of probes) {
            let emitted: string;
            try {
                emitted = lower({ [key]: value });
            } catch {
                // A refusal is not an escape: the key emitted nothing at all.
                continue;
            }
            for (const token of emitted.split(' ').filter(Boolean)) {
                if (inNamespace(token, prefix)) continue;
                out.push(
                    `  { ${key}: ${JSON.stringify(value)} } owns \`${prefix}\` ` +
                        `but emitted \`${token}\``,
                );
            }
        }
        return out;
    }

    it.each(ENGINES)('%s: documented values stay in their namespace', (_lane, lower) => {
        const found = escapes(documented, lower);
        expect(
            found,
            `${found.length} class(es) left the namespace their key owns:\n${found.join('\n')}`,
        ).toEqual([]);
    });

    it.each(ENGINES)('%s: undocumented values stay in their namespace', (_lane, lower) => {
        // This is the half that would have caught `maxW: 'container'`: no
        // fixture names the value, so only a probe reaches it.
        const found = escapes(undocumented, lower);
        expect(
            found,
            `${found.length} class(es) left the namespace their key owns:\n${found.join('\n')}`,
        ).toEqual([]);
    });

    it('the exemption list still describes the engines', () => {
        // A key that stopped needing the exemption must leave the list, or the
        // list slowly becomes the place a real escape can hide. Each probe is a
        // value the key actually documents, since a rejected value would emit
        // nothing and read as "no longer exempt".
        const PROBE: Readonly<Record<string, string>> = {
            decoration: 'underline',
            display: 'flex',
            fontSmoothing: 'grayscale',
            fontStyle: 'italic',
            isolation: 'isolate',
            position: 'absolute',
            textTransform: 'uppercase',
            visibility: 'visible',
        };
        expect(Object.keys(PROBE).sort()).toEqual([...VALUE_ALIAS_KEYS].sort());

        const stillBare = [...VALUE_ALIAS_KEYS].filter(key => {
            const prefix = PROPERTY_MAP[key];
            if (prefix === undefined) return false;
            const emitted = transform({ [key]: PROBE[key] as string })
                .className.split(' ')
                .filter(Boolean);
            return emitted.some(token => !inNamespace(token, prefix));
        });
        expect(stillBare.sort()).toEqual([...VALUE_ALIAS_KEYS].sort());
    });
});
