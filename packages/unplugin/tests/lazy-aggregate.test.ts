/**
 * The per-file aggregate that used to be rebuilt on every write.
 *
 * `set`/`delete` only record the file's contribution; the aggregate is built
 * when read, and only when something changed since the last read. Writes in a
 * row cost one rebuild, not one each — that is the whole point.
 */
import { describe, expect, it, vi } from 'vitest';
import { createLazyAggregate } from '../src/lazy-aggregate.js';

/**
 * Aggregate in the shape the plugin uses: entries per file, one merged record.
 *
 * @returns The store plus a spy on its merge function.
 */
function sumAggregate() {
    const build = vi.fn((byFile: ReadonlyMap<string, number[]>) => {
        let total = 0;
        for (const file of [...byFile.keys()].sort()) {
            for (const value of byFile.get(file) ?? []) total += value;
        }
        return { total, files: byFile.size };
    });
    return { build, aggregate: createLazyAggregate(build, { total: 0, files: 0 }) };
}

describe('createLazyAggregate', () => {
    it('serves the initial value without building', () => {
        const { build, aggregate } = sumAggregate();
        expect(aggregate.get()).toEqual({ total: 0, files: 0 });
        expect(build).not.toHaveBeenCalled();
    });

    it('builds once for a run of writes, not once per write', () => {
        const { build, aggregate } = sumAggregate();
        for (let index = 0; index < 1000; index++) aggregate.set(`file-${index}`, [index]);
        expect(build).not.toHaveBeenCalled();
        expect(aggregate.get()).toEqual({ total: 499_500, files: 1000 });
        expect(build).toHaveBeenCalledTimes(1);
        expect(aggregate.get()).toEqual({ total: 499_500, files: 1000 });
        expect(build).toHaveBeenCalledTimes(1);
    });

    it('rebuilds after a later write, and after a delete', () => {
        const { build, aggregate } = sumAggregate();
        aggregate.set('a', [1]);
        aggregate.get();
        aggregate.set('a', [5]);
        expect(aggregate.get()).toEqual({ total: 5, files: 1 });
        aggregate.delete('a');
        expect(aggregate.get()).toEqual({ total: 0, files: 0 });
        expect(build).toHaveBeenCalledTimes(3);
    });

    it('does not rebuild for a delete of a file it never held', () => {
        const { build, aggregate } = sumAggregate();
        aggregate.set('a', [1]);
        aggregate.get();
        aggregate.delete('missing');
        aggregate.get();
        expect(build).toHaveBeenCalledTimes(1);
    });

    it('exposes the per-file entries it aggregates', () => {
        const { aggregate } = sumAggregate();
        aggregate.set('a', [1, 2]);
        expect([...aggregate.entries]).toEqual([['a', [1, 2]]]);
    });
});
