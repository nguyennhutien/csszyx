import type ts from 'typescript/lib/tsserverlibrary';

/** Merge without mutating or replacing semantically equivalent base entries.
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
    const accepted: ts.CompletionEntry[] = [];
    for (const item of additions) {
        if (baseEntries.length + accepted.length >= maxWork) break;
        const identity = `${item.name}\u0000${item.source ?? ''}`;
        if (!identities.has(identity)) {
            identities.add(identity);
            accepted.push(item);
        }
    }
    if (accepted.length === 0) return prior;
    return {
        ...(prior ?? {
            isGlobalCompletion: false,
            isMemberCompletion: true,
            isNewIdentifierLocation: true,
        }),
        entries: [...baseEntries, ...accepted],
    };
}
