import type ts from 'typescript/lib/tsserverlibrary';

/** Merge csszyx additions into a base completion list.
 *
 * Base entries stay semantically authoritative: a name collision keeps the base
 * entry (its kind, sortText, type-resolved details, deprecation flags), and the
 * colliding csszyx addition is dropped. The one thing a collision gains is the
 * addition's `labelDetails.description` (the "→ bg-*" hint), added on a CLONE of
 * the base entry so both lists read as one product — the original entry object
 * is never mutated, an existing base description is never overwritten, and no
 * csszyx `data` is attached, so details keep resolving through the base service.
 * @param prior - Base TypeScript completion result.
 * @param additions - Bounded csszyx entries.
 * @param maxWork - Maximum total entries examined and returned.
 * @returns The original base object when unchanged, otherwise a copied result.
 */
export function mergeCompletions(
    prior: ts.CompletionInfo | undefined,
    additions: readonly ts.CompletionEntry[],
    maxWork: number,
): ts.CompletionInfo | undefined {
    if (additions.length === 0) return prior;
    const baseEntries = prior?.entries ?? [];
    const identities = new Set(
        baseEntries.slice(0, maxWork).map(item => `${item.name}\u0000${item.source ?? ''}`),
    );
    const descriptions = new Map<string, string>();
    for (const item of additions) {
        const description = item.labelDetails?.description;
        if (description) descriptions.set(item.name, description);
    }
    const accepted: ts.CompletionEntry[] = [];
    for (const item of additions) {
        if (baseEntries.length + accepted.length >= maxWork) break;
        const identity = `${item.name}\u0000${item.source ?? ''}`;
        if (!identities.has(identity)) {
            identities.add(identity);
            accepted.push(item);
        }
    }
    let decorated = 0;
    const mergedBase = baseEntries.slice(0, maxWork).map(entry => {
        const description = descriptions.get(entry.name);
        if (description === undefined || entry.labelDetails?.description) return entry;
        decorated += 1;
        return { ...entry, labelDetails: { ...entry.labelDetails, description } };
    });
    if (accepted.length === 0 && decorated === 0) return prior;
    return {
        ...(prior ?? {
            isGlobalCompletion: false,
            isMemberCompletion: true,
            isNewIdentifierLocation: true,
        }),
        entries: [...mergedBase, ...baseEntries.slice(maxWork), ...accepted],
    };
}
