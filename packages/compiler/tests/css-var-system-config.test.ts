import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { transformOxc } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../..');

describe('CSS variable system config contract', () => {
    it('keeps production.mangleVars opt-in by default', () => {
        const typesConfig = readFileSync(join(REPO_ROOT, 'packages/types/src/config.ts'), 'utf8');
        const configDocs = readFileSync(
            join(REPO_ROOT, 'apps/docs/src/content/docs/docs/reference/config.mdx'),
            'utf8',
        );

        expect(typesConfig).toContain('mangleVars: boolean;');
        expect(typesConfig).toContain('@default false');
        expect(typesConfig).toMatch(/DEFAULT_PRODUCTION_CONFIG[\s\S]*mangleVars:\s*false,/);
        expect(configDocs).toContain('mangleVars: boolean;');
        expect(configDocs).toContain('| `mangleVars`       | `false`');
    });

    it('preserves existing dynamic CSS variable output when mangleVars is disabled', () => {
        const source = 'const App = ({ pad, gap }) => <div sz={{ p: pad, md: { gap } }} />;';
        const result = transformOxc(source, 'mangle-vars-disabled.tsx');

        expect(result.code).toContain('p-(--_sz-p)');
        expect(result.code).toContain('md:gap-(--_sz-md-gap)');
        expect(result.code).toContain('"--_sz-p"');
        expect(result.code).toContain('"--_sz-md-gap"');
        expect(result.classes).toEqual(new Set(['p-(--_sz-p)', 'md:gap-(--_sz-md-gap)']));
    });

    it.todo('maps scoped dynamic variables to per-element s-tier names when mangleVars is enabled');
    it.todo('hoists repeated component-tier variables to a bounded common ancestor');
    it.todo('keeps CSS variable names out of the checksum payload while mangleVars is disabled');
});
