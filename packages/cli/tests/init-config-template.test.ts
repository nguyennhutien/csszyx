/**
 * The `csszyx.config.ts` that `csszyx init` writes has to type-check.
 *
 * It used to declare `const config: CsszyxConfig = { development: { debug:
 * true } }`, and `CsszyxConfig` requires every section and field, so a fresh
 * project failed `tsc --strict` with TS2741 on its first build. The template
 * now goes through `defineConfig`, whose argument is all optional.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import { generateConfigFile } from '../src/commands/init.js';

const REPO = resolve(import.meta.dirname, '../../..');
const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the config file csszyx init writes', () => {
    it('type-checks under --strict against the type defineConfig takes', () => {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-init-template-'));
        dirs.push(dir);
        const file = join(dir, 'csszyx.config.ts');
        writeFileSync(file, generateConfigFile());
        const program = ts.createProgram([file], {
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            // The template imports `csszyx`; the type it reads lives here.
            paths: { csszyx: [join(REPO, 'packages/types/src/diagnostics.ts')] },
        });

        const errors = ts
            .getPreEmitDiagnostics(program)
            .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));

        expect(errors).toEqual([]);
        expect(generateConfigFile()).toContain('defineConfig({');
    });
});
