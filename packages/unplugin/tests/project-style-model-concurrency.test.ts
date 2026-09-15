/** Bounded concurrency of the two Tailwind inspection phases. */
import path from 'node:path';

import { createEmittedClassOracle, readStylesheetRole } from '@csszyx/tailwind-oracle';
import { beforeEach, expect, it, vi } from 'vitest';

import { openProjectStyleModel } from '../src/project-style-model.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

const activity = vi.hoisted(() => ({ active: 0, peak: 0 }));

vi.mock('@csszyx/tailwind-oracle', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/tailwind-oracle')>();
    const tracked = async <T>(operation: () => Promise<T>): Promise<T> => {
        activity.active += 1;
        activity.peak = Math.max(activity.peak, activity.active);
        try {
            // Keep independent calls overlapped long enough for the test to
            // distinguish bounded parallel work from the old serial loops.
            await new Promise(resolve => setTimeout(resolve, 10));
            return await operation();
        } finally {
            activity.active -= 1;
        }
    };
    return {
        ...actual,
        readStylesheetRole: vi.fn((...args: Parameters<typeof actual.readStylesheetRole>) =>
            tracked(() => actual.readStylesheetRole(...args)),
        ),
        createEmittedClassOracle: vi.fn(
            (...args: Parameters<typeof actual.createEmittedClassOracle>) =>
                tracked(() => actual.createEmittedClassOracle(...args)),
        ),
    };
});

beforeEach(() => {
    removeTailwindProjects();
    activity.active = 0;
    activity.peak = 0;
    vi.mocked(readStylesheetRole).mockClear();
    vi.mocked(createEmittedClassOracle).mockClear();
});

it('opens independent roots two at a time and preserves candidate order', async () => {
    const files = Object.fromEntries(
        Array.from({ length: 6 }, (_, index) => [
            `styles/root-${index}.css`,
            `@import "tailwindcss";\n@theme { --color-c${index}: #123; }\n`,
        ]),
    );
    const root = tailwindProject('csszyx-style-concurrency-', files);
    const candidates = Object.keys(files).map(file => path.join(root, file));

    const model = await openProjectStyleModel(root, candidates);

    expect(activity.peak).toBe(2);
    expect(model.entries.map(entry => entry.file)).toEqual(candidates);
    expect(model.entries.every(entry => entry.role === 'root')).toBe(true);
    expect(readStylesheetRole).toHaveBeenCalledTimes(6);
    expect(createEmittedClassOracle).toHaveBeenCalledTimes(6);
}, 60_000);

it('finishes classification before excluding an imported root from design-system work', async () => {
    const root = tailwindProject('csszyx-style-concurrency-import-', {
        'styles/partial.css': '@import "tailwindcss";\n',
        'styles/app.css': '@import "./partial.css";\n',
    });
    const candidates = ['styles/partial.css', 'styles/app.css'].map(file => path.join(root, file));

    const model = await openProjectStyleModel(root, candidates);

    expect(model.entries.map(entry => entry.role)).toEqual(['imported', 'root']);
    expect(readStylesheetRole).toHaveBeenCalledTimes(2);
    expect(createEmittedClassOracle).toHaveBeenCalledTimes(1);
}, 60_000);
