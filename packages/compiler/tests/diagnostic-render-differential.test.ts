/**
 * The renderer against the engine, on every frozen form (ADR 0031).
 *
 * Until the engine stops writing sentences, each diagnostic is written twice:
 * by the engine from the values it holds at the site, and by the registry's
 * template from the args the issue carries. The two must be byte-identical on
 * both artifacts, which proves the args carry everything the sentence says
 * before the engine's copy is deleted.
 *
 * Reads the engine's own text through `@csszyx/core`, beneath the compiler's
 * lanes, which render their `diagnostics` from the issues.
 */
import { createRequire } from 'node:module';

import { transformBatch } from '@csszyx/core/native';
import { describe, expect, it } from 'vitest';

import { renderSzDiagnosticBody } from '../src/diagnostic-render.js';
import { SZ_DIAGNOSTIC_COMPUTED_VALUES } from '../src/diagnostic-render-helpers.js';
import type { SzDiagnosticCode } from '../src/index.js';
import { nativeTransformOptions } from '../src/transform-rust.js';
import { wasmTransformOptions } from '../src/transform-wasm.js';
import { FREEZE_SOURCES } from './diagnostic-freeze-sources.js';
import { RUST_LANE } from './engine-parity-harness.js';

/** One issue and the engine's text beside it. */
interface Rendered {
    code: string;
    args: object;
    text: string;
}

const wasm = createRequire(import.meta.url)('@csszyx/core/parser-wasm') as {
    transform_batch_json(files: string, options: string): string;
};

/**
 * Each issue of a source beside the engine's text, from one artifact.
 *
 * @param artifact - Which artifact transforms it.
 * @param entry - The source.
 * @returns The issues.
 */
function engineIssues(
    artifact: 'wasm' | 'rust',
    entry: (typeof FREEZE_SOURCES)[number],
): Rendered[] {
    const file = { filename: entry.filename ?? 'src/freeze.tsx', source: entry.source };
    if (artifact === 'wasm') {
        const [result] = JSON.parse(
            wasm.transform_batch_json(
                JSON.stringify([file]),
                JSON.stringify(wasmTransformOptions(entry.options)),
            ),
        ) as Array<{ diagnostics: string[]; issues: Array<{ code: string; args: object }> }>;
        return (result?.issues ?? []).map((issue, index) => ({
            ...issue,
            text: result?.diagnostics[index] ?? '',
        }));
    }
    const [result] = transformBatch([file], nativeTransformOptions(entry.options)) as Array<{
        diagnostics: string[];
        issues: Array<{ code: string; argsJson: string }>;
    }>;
    return (result?.issues ?? []).map((issue, index) => ({
        code: issue.code,
        args: JSON.parse(issue.argsJson),
        text: result?.diagnostics[index] ?? '',
    }));
}

const ARTIFACTS = RUST_LANE ? (['wasm', 'rust'] as const) : (['wasm'] as const);

describe('the renderer writes what the engine writes', () => {
    it.each(ARTIFACTS)('on every frozen form, on %s', artifact => {
        const differences: string[] = [];
        const forms = new Set<string>();
        for (const entry of FREEZE_SOURCES) {
            const issues = engineIssues(artifact, entry);
            if (issues.some(issue => issue.code === entry.code))
                forms.add(`${entry.code}/${entry.variant}`);
            for (const issue of issues) {
                const rendered = renderSzDiagnosticBody(
                    { code: issue.code as SzDiagnosticCode, args: issue.args },
                    SZ_DIAGNOSTIC_COMPUTED_VALUES,
                );
                if (rendered !== issue.text) {
                    differences.push(
                        `${entry.code}/${entry.variant} ${JSON.stringify(issue.args)}\n  engine:   ${JSON.stringify(issue.text)}\n  rendered: ${JSON.stringify(rendered)}`,
                    );
                }
            }
        }
        expect(differences, differences.join('\n')).toEqual([]);
        // Every form reached the comparison: an option a lane drops would
        // leave its form out silently.
        expect(forms.size).toBe(FREEZE_SOURCES.length);
    });
});
