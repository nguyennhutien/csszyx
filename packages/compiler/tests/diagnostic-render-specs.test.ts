/**
 * The renderer reads a slim copy of the registry: per id, only the fields a
 * line is rendered from. The full specification (summaries, surfaces, forms,
 * arg types) is for tests and tools, and no compiler entry may load it: a
 * Node entry such as `./engine` would carry every id's metadata for nothing.
 *
 * A product source that reads a dropped field off a render spec does not
 * type-check, since `SzDiagnosticRenderSpec` has no such field; these pin the
 * data and the import graph that keep it so.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SZ_DIAGNOSTIC_RENDER_SPECS } from '../src/diagnostic-registry.generated.js';
import { SZ_DIAGNOSTIC_REGISTRY } from '../src/diagnostic-spec.generated.js';
import { compilerEntry, compilerSrc, reachable } from './helpers/value-import-graph.js';

/** The fields a line is rendered from, and nothing else. */
const RENDER_FIELDS = ['id', 'position', 'args', 'joiners', 'variesBy', 'text', 'help', 'note'];

describe('the render specs', () => {
    it('are the registry cut down to the fields a line is rendered from', () => {
        expect(SZ_DIAGNOSTIC_RENDER_SPECS.map(spec => spec.id)).toEqual(
            SZ_DIAGNOSTIC_REGISTRY.map(spec => spec.id),
        );
        for (const [index, spec] of SZ_DIAGNOSTIC_REGISTRY.entries()) {
            const rendered = SZ_DIAGNOSTIC_RENDER_SPECS[index] as Record<string, unknown>;
            for (const field of Object.keys(rendered)) {
                expect(RENDER_FIELDS, `${spec.id}.${field}`).toContain(field);
            }
            expect(rendered.position).toBe(spec.position);
            expect(rendered.variesBy).toBe(spec.variesBy);
            for (const field of ['text', 'help', 'note'] as const) {
                expect(rendered[field], `${spec.id}.${field}`).toEqual(spec[field]);
            }
            // Every arg in registry order as one string, each one the entry
            // may leave out marked `?`, and nothing else.
            const args = Object.entries(spec.args);
            expect(rendered.args, spec.id).toBe(
                args.map(([name, arg]) => (arg.optional ? `${name}?` : name)).join(' '),
            );
            // Each list arg's joiner, and no `joiners` at all where none has one.
            const joiners = args.filter(([, arg]) => arg.joiner !== undefined);
            expect(rendered.joiners, spec.id).toEqual(
                joiners.length === 0
                    ? undefined
                    : Object.fromEntries(joiners.map(([name, arg]) => [name, arg.joiner])),
            );
            expect('joiners' in rendered, spec.id).toBe(joiners.length > 0);
        }
    });

    it('carry no summary, surface, form or arg type for a reader to take as absent', () => {
        for (const spec of SZ_DIAGNOSTIC_RENDER_SPECS as ReadonlyArray<Record<string, unknown>>) {
            for (const dropped of ['summary', 'surfaces', 'forms', 'defaults', 'gaps']) {
                expect(dropped in spec, `${spec.id}.${dropped}`).toBe(false);
            }
        }
    });
});

describe('the full specification', () => {
    it('is reached from no compiler entry', () => {
        const { exports } = JSON.parse(
            readFileSync(path.join(compilerSrc, '../package.json'), 'utf8'),
        ) as { exports: Record<string, unknown> };
        const subpaths = Object.keys(exports).filter(
            subpath => subpath !== './package.json' && !subpath.endsWith('.json'),
        );
        expect(subpaths).toContain('./engine');
        expect(subpaths).toContain('./internal');
        const reached = reachable(
            subpaths.map(subpath => compilerEntry(`@csszyx/compiler${subpath.slice(1)}`)),
        );
        expect(reached).toContain(path.join(compilerSrc, 'diagnostic-registry.generated.ts'));
        expect(reached).not.toContain(path.join(compilerSrc, 'diagnostic-spec.generated.ts'));
    });
});
