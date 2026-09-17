/**
 * Mangle-aware className merge with last-wins override semantics.
 *
 * The design-system layered-component pattern (Box < Flex < Row/Col) flows
 * className strings down and resolves overrides ONCE at the leaf: a later class
 * overrides an earlier one of the SAME utility (e.g. an app's `gap-8` overriding
 * a component default `gap-2`). npm `tailwind-merge` cannot do this here because
 * in a production build csszyx MANGLES owned classes (`gap-2` → `q3`,
 * `gap-8` → `q7`), and tailwind-merge can't tell `q3`/`q7` are the same utility.
 *
 * csszyx owns the reverse mangle map, registered at runtime by the bundled
 * module (`getMangleRegistry().decode(mangled) → original`). So this merge
 * decodes each token to its original name, looks its signature up in the table
 * the build generated from the project's compiled CSS, drops every earlier
 * token whose signature the new one covers, and returns the survivors (still
 * in their original — possibly mangled — token form, so the DOM matches the
 * built CSS).
 *
 * A later class covers an earlier one only when, in every selector and at-rule
 * context the earlier one declares something, it declares all of the same
 * properties. `text-2xl` sets `line-height` as well as `font-size`, so a later
 * `text-[0.8rem]` does not cover it and both stay.
 *
 * Fail-safe: a class with no signature — one the build never saw, or every
 * class before a build has registered a table — is only ever its own
 * duplicate. At worst two classes coexist (the pre-merge status quo); a class
 * is never dropped on the strength of how it is spelled.
 *
 * @module
 */
import { decodeToken, encodeToken, type MangleBridge, mangleBridge } from './class-codec.js';
import { getMergeSignatureGeneration, getMergeSignatureTable } from './merge-signatures.js';

/** Class string accepted by the public and generated merge helpers. */
type ClassInput = string | false | null | undefined;

const hasOwn = Object.prototype.hasOwnProperty;

/**
 * One memoized argument position. The memo is a TRIE over the input strings,
 * not a map keyed by their concatenation: building `${a} ${b}` produces a fresh
 * V8 cons-string on every call, and a cons-string carries no cached hash, so
 * each `Map` operation on it re-flattens and re-hashes the whole key —
 * measured at ~115 ns, an order of magnitude more than the merge lookup it was
 * meant to save. Walking one `Map.get` per argument instead hashes nothing: the
 * arguments are the caller's own string constants, already internalized with
 * their hash cached (measured ~7 ns for the two-argument layered-component
 * shape).
 */
interface MergeMemoNode {
    /** Merged output for the exact input path ending at this node. */
    result?: string;
    /** Children keyed by the next non-empty string input. */
    next?: Map<string, MergeMemoNode>;
}

/**
 * Memo for repeated merges. Layered components call szcn with IDENTICAL inputs
 * every render (component defaults are constants), so the trie turns the
 * per-render cost into one Map lookup per argument. The cache self-invalidates
 * when either merge input changes: the registered signature table, or the
 * identity of the runtime decode bridge (both normally settle at startup,
 * before render loops, so steady-state renders never clear).
 *
 * Over the cap the trie STOPS ADMITTING new paths rather than evicting — the
 * same policy `splitBox`'s token memo uses. Per-entry LRU recency needs a
 * `delete` + `set` on every HIT (measured ~11% of the hit cost), and dropping
 * the whole trie at the cap flushed every hot entry each time a batch of
 * distinct inputs crossed it — `szcn(BASE, props.className)` in a list render
 * does exactly that. Admission-stop keeps the working set (the app's
 * component-count paths, captured early) hot at zero per-hit cost; overflow
 * traffic pays only its own uncached merge, which it paid under either policy.
 */
const MEMO_MAX_NODES = 500;
const memoRoot: MergeMemoNode = {};
let memoNodes = 0;
let memoSignatureGeneration = -1;
let memoDecodeRef: unknown;

/**
 * Merge className strings with last-wins override per utility, mangle-aware and
 * memoized (see the memo note above — repeated inputs return in one Map lookup).
 *
 * Intended for the single resolution point in a layered design-system component
 * (typically at the leaf Box): combine the component's default classes with the
 * forwarded override so the override wins on a same-utility collision, while
 * keeping production mangling intact (unlike npm tailwind-merge).
 *
 * @param inputs - Class strings; falsy inputs (`false`/`null`/`undefined`/`''`) are skipped.
 * @returns The merged className string.
 * @example szcn('gap-2 p-4', 'gap-8') // → 'p-4 gap-8'  (gap-8 overrides gap-2)
 */
export function szcn(...inputs: ClassInput[]): string {
    const signatureGeneration = getMergeSignatureGeneration();
    // Compare the runtime OBJECT IDENTITY, not mere presence: a swapped bridge
    // (tests, or an exotic host replacing the inline script's object) must not
    // serve merges memoized under the previous map. The object carries both
    // the decode bridge and the encode map, so one identity check covers both
    // lookups. In production it is installed once for the page lifetime, so
    // this never clears.
    const runtimeRef = mangleBridge();
    if (signatureGeneration !== memoSignatureGeneration || runtimeRef !== memoDecodeRef) {
        memoRoot.result = undefined;
        memoRoot.next = undefined;
        memoNodes = 0;
        memoSignatureGeneration = signatureGeneration;
        memoDecodeRef = runtimeRef;
    }
    // Falsy inputs are skipped here exactly as `mergeUncached` skips them, so
    // `szcn('a', false, 'b')` and `szcn('a', 'b')` share one trie path.
    let node = memoRoot;
    for (const input of inputs) {
        if (!input || typeof input !== 'string') {
            continue;
        }
        let child = node.next?.get(input);
        if (child === undefined) {
            // Admission stop at the cap (see the memo note): the walk so far
            // stays byte-identical for cached paths, and a novel path past
            // the cap takes the uncached merge without disturbing the trie.
            if (memoNodes >= MEMO_MAX_NODES) {
                return mergeUncached(inputs, runtimeRef);
            }
            child = {};
            node.next ??= new Map();
            node.next.set(input, child);
            memoNodes++;
        }
        node = child;
    }
    let merged = node.result;
    if (merged === undefined) {
        merged = mergeUncached(inputs, runtimeRef);
        node.result = merged;
    }
    return merged;
}

/**
 * Compiler-injected variant of {@link szcn} for compiled `sz={[...]}` arrays —
 * identical merge semantics, NO memo. The memo exists for layered components
 * that pass IDENTICAL constant inputs every render; compiled arrays carry
 * runtime parts (`_szPart(row.style)`) that vary per element, so routing them
 * through the shared 500-entry LRU would never hit AND would evict the hot
 * layered-component entries — a list render could flush the memo several
 * times over per frame. Skipping the memo keeps each call at the plain
 * uncached cost and leaves the authored-`szcn` fast path untouched.
 *
 * The `_` prefix marks it as generated-code-only (like `_sz`/`_szMerge`/
 * `_szPart`) — hand-author `szcn` instead.
 *
 * @param inputs - Class strings; falsy inputs (`false`/`null`/`undefined`/`''`) are skipped.
 * @returns The merged className string.
 */
export function _szcn(...inputs: ClassInput[]): string {
    return mergeUncached(inputs, mangleBridge());
}

/**
 * The uncached merge — see {@link szcn} for the contract.
 *
 * @param inputs - Class strings; falsy inputs are skipped.
 * @param bridge - The runtime bridge, read once by the caller.
 * @returns The merged className string.
 */
function mergeUncached(inputs: readonly ClassInput[], bridge: MangleBridge | undefined): string {
    const order: (string | number)[] = [];
    const byKey = new Map<string | number, string>();

    for (const input of inputs) {
        if (!input || typeof input !== 'string') {
            continue;
        }
        for (const token of input.split(/\s+/)) {
            if (token) mergeClassToken(token, order, byKey, bridge);
        }
    }

    return order.map(key => byKey.get(key) as string).join(' ');
}

/**
 * Merge one class token into the ordered survivor map.
 * @param token - Encoded class token.
 * @param order - Ordered survivor keys.
 * @param byKey - Survivor token lookup.
 * @param bridge - The runtime bridge read once per merge.
 */
function mergeClassToken(
    token: string,
    order: (string | number)[],
    byKey: Map<string | number, string>,
    bridge: MangleBridge | undefined,
): void {
    const original = decodeToken(token, bridge);
    const signatureTable = getMergeSignatureTable();
    // A class the build gave no signature — every class, before a build has
    // registered a table — is only ever its own duplicate: nothing compiled
    // has proved it sets what another class sets.
    const signature =
        signatureTable !== undefined && hasOwn.call(signatureTable[0], original)
            ? signatureTable[0][original]
            : undefined;
    const key = signature === undefined ? original : signature;
    // An id with no coverage row covers itself: a table cut short must still
    // drop an exact repeat, the one merge that needs no evidence.
    const covered =
        signatureTable === undefined || signature === undefined
            ? [key]
            : (signatureTable[1][signature] ?? [key]);
    for (const coveredKey of covered) {
        if (!byKey.delete(coveredKey)) continue;
        const index = order.indexOf(coveredKey);
        if (index !== -1) order.splice(index, 1);
    }
    byKey.set(key, encodeToken(token, bridge));
    order.push(key);
}

/**
 * Resolve a class token to its original (un-mangled) name.
 *
 * For class introspection on production-mangled builds: code that inspects a
 * `className` for a utility by its original spelling (e.g. "does this element
 * carry a `w-*` width?") receives mangled tokens there, so decode each token
 * before matching. Identity on unmangled builds, in dev, and for any token the
 * map does not cover — safe to call unconditionally.
 *
 * @param token - A single class token, possibly mangled.
 * @returns The original class name, or the token itself when not mangled.
 * @example
 * szDecode('q3') // 'w-full' on a build that mangled it; 'q3' otherwise
 * // To ask "does this element carry a width?", use `has(className, 'w')`:
 * // it decodes and strips the variant, where `szDecode(t).startsWith('w-')`
 * // is false for `md:w-full`.
 */
export function szDecode(token: string): string {
    return decodeToken(token, mangleBridge());
}
