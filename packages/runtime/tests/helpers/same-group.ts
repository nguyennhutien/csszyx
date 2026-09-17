/**
 * The registry of custom theme tokens, observed where it is still read.
 *
 * `szcn` no longer consults it: merging rests on the table generated from
 * compiled CSS. `classify` and `splitBox` do, through
 * `classifyAmbiguousValue`, so that is where the registry's behaviour shows.
 *
 * @module
 */
import { classifyAmbiguousValue } from '../../src/merge-groups.js';

/**
 * Whether two values of one ambiguous prefix land in the same property group.
 *
 * @param prefix - The ambiguous utility prefix, such as `text` or `bg`.
 * @param first - One value after the prefix.
 * @param second - Another value after the prefix.
 * @returns True when both classify, and to the same group.
 */
export function sameGroup(prefix: string, first: string, second: string): boolean {
    const group = classifyAmbiguousValue(prefix, first);
    return group !== null && group === classifyAmbiguousValue(prefix, second);
}
