/**
 * A prefixed project lowers its files twice: once without the prefix, to find
 * the stylesheets, and once with it. An engine that stops running between the
 * two must stop the check there too, not report the first pass as clean.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CsszyxError } from '@csszyx/compiler/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { check } from '../src/commands/check.js';
import { linkTailwind } from './link-tailwind.js';

vi.mock('@csszyx/compiler/engine', async importActual => {
    const actual = await importActual<typeof import('@csszyx/compiler/engine')>();
    return {
        ...actual,
        transformSource: (
            source: string,
            options?: Parameters<typeof actual.transformSource>[1],
        ) => {
            if (options?.classPrefix) {
                throw new CsszyxError({
                    code: 'engine-version-skew',
                    args: {},
                    message: '[csszyx] engine-version-skew: the engine cannot run here.',
                });
            }
            return actual.transformSource(source, options);
        },
    };
});

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

describe('csszyx check when the engine stops on the prefixed pass', () => {
    it('stops and fails instead of reporting the project clean', async () => {
        const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'csszyx-check-engine-prefix-')));
        roots.push(root);
        linkTailwind(root);
        writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n', 'utf8');
        mkdirSync(path.join(root, 'src'));
        writeFileSync(path.join(root, 'src/app.css'), '@import "tailwindcss" prefix(tw);\n');
        writeFileSync(
            path.join(root, 'src/Card.tsx'),
            'export const Card = () => <div sz={{ p: 4 }} />;\n',
        );
        const lines: string[] = [];
        const record = (...args: unknown[]) => lines.push(args.map(String).join(' '));
        vi.spyOn(console, 'log').mockImplementation(record);
        vi.spyOn(console, 'warn').mockImplementation(record);
        vi.spyOn(console, 'error').mockImplementation(record);

        await check({ cwd: root });

        const report = lines.join('\n');
        expect(report).toContain('[csszyx] engine-version-skew:');
        expect(report).toContain('no file was checked');
        expect(report).not.toContain('No sz issues');
        expect(process.exitCode).toBe(1);
    }, 60_000);
});
