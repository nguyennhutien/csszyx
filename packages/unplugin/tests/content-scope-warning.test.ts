import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    cssHasContentScope,
    isMonorepoPackage,
    shouldWarnUnscopedMonorepo,
    unscopedMonorepoMessage,
} from '../src/unplugin.js';

describe('cssHasContentScope', () => {
    it('true for source(none)', () => {
        expect(cssHasContentScope('@import "tailwindcss" source(none);')).toBe(true);
    });
    it('true for source("../src")', () => {
        expect(cssHasContentScope('@import "tailwindcss" source("../src");')).toBe(true);
    });
    it('true for @source not', () => {
        expect(cssHasContentScope('@import "tailwindcss";\n@source not "../docs";')).toBe(true);
    });
    it('false for a plain additive @source (does not stop the broad scan)', () => {
        expect(cssHasContentScope('@import "tailwindcss";\n@source "./safelist.html";')).toBe(
            false,
        );
    });
    it('false for a bare import', () => {
        expect(cssHasContentScope('@import "tailwindcss";')).toBe(false);
    });
    it('ignores commented-out directives', () => {
        expect(cssHasContentScope('@import "tailwindcss";\n/* @source not "x"; */')).toBe(false);
    });
});

describe('shouldWarnUnscopedMonorepo', () => {
    it('warns only when an entry is seen, unscoped, and inside a monorepo', () => {
        expect(shouldWarnUnscopedMonorepo(true, false, true)).toBe(true);
    });
    it('is silent when the entry is scoped', () => {
        expect(shouldWarnUnscopedMonorepo(true, true, true)).toBe(false);
    });
    it('is silent outside a monorepo', () => {
        expect(shouldWarnUnscopedMonorepo(true, false, false)).toBe(false);
    });
    it('is silent with no Tailwind entry', () => {
        expect(shouldWarnUnscopedMonorepo(false, false, true)).toBe(false);
    });
});

describe('unscopedMonorepoMessage', () => {
    it('names the exact fix and the silence option', () => {
        const m = unscopedMonorepoMessage();
        expect(m).toContain('source(none)');
        expect(m).toContain('@source ".";');
        expect(m).toContain('contentScopeCheck: false');
    });
});

describe('isMonorepoPackage', () => {
    it('detects a pnpm-workspace.yaml ancestor', () => {
        const root = mkdtempSync(path.join(tmpdir(), 'csszyx-mono-'));
        try {
            writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
            const pkg = path.join(root, 'packages', 'web');
            mkdirSync(pkg, { recursive: true });
            expect(isMonorepoPackage(pkg)).toBe(true);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
    it('returns false for a standalone project', () => {
        const root = mkdtempSync(path.join(tmpdir(), 'csszyx-solo-'));
        try {
            writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'solo' }));
            expect(isMonorepoPackage(root)).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
