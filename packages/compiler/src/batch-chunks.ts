/**
 * Cut a batch of sources into runs whose text stays under a length.
 *
 * @module batch-chunks
 */

/**
 * The files in order, cut so no chunk's sources together pass `limit`
 * characters, except a single file longer than it, which is a chunk alone.
 *
 * @param files - The batch, in order.
 * @param limit - Characters a chunk may hold.
 * @returns The chunks, each non-empty, in order.
 */
export function chunksByLength<T extends { readonly source: string }>(
    files: readonly T[],
    limit: number,
): T[][] {
    const chunks: T[][] = [];
    let current: T[] = [];
    let length = 0;
    for (const file of files) {
        if (current.length > 0 && length + file.source.length > limit) {
            chunks.push(current);
            current = [];
            length = 0;
        }
        current.push(file);
        length += file.source.length;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
}
