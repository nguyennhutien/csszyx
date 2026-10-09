/**
 * What `check` records for a finding, at the level the project gives it.
 *
 * `off` is the one level that means "not reported": a pass may still push
 * the finding, and the reporter drops it, so neither `--json` nor the exit
 * status sees it.
 */
import { createDiagnosticPolicy } from '@csszyx/unplugin/diagnostics';
import { describe, expect, it } from 'vitest';

import { createReporter } from '../src/scanner/check-report.js';

describe('the check reporter', () => {
    it('drops a finding the project turns off, and keeps the others with their level', () => {
        const out = createReporter(
            true,
            createDiagnosticPolicy({ rules: { 'dead-class': 'off', 'broken-opacity': 'warn' } }),
        );
        out.push({ rule: 'dead-class', file: 'src/A.tsx', message: 'styles nothing' });
        out.push({ rule: 'broken-opacity', file: 'src/A.tsx', message: 'no opacity' });

        expect(out.findings).toEqual([
            {
                rule: 'broken-opacity',
                kind: 'broken-opacity',
                file: 'src/A.tsx',
                message: 'no opacity',
                level: 'warn',
            },
        ]);
    });
});
