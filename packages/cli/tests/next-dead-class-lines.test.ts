/**
 * What `csszyx next prebuild` and `next watch` print for dead `sz` classes.
 *
 * They are the Turbopack lane's build step, so they follow the switches every
 * other lane follows: `CSSZYX_QUIET_SZ_WARNINGS=1` mutes the findings, and a
 * production prebuild counts an `info` finding in one closing line rather than
 * dropping it without a word.
 */
import {
    createDiagnosticLimiter,
    createDiagnosticPolicy,
    deadClassMessage,
    suppressedAdvisoryMessage,
} from '@csszyx/unplugin/diagnostics';
import { describe, expect, it } from 'vitest';

import { nextDeadClassLines } from '../src/commands/next-diagnostic-policy.js';

const DEAD = [{ className: 'break-bogus', file: 'app/page.tsx' }];

describe('nextDeadClassLines', () => {
    it('lists a dead class at the default level', () => {
        expect(
            nextDeadClassLines(
                DEAD,
                createDiagnosticPolicy(),
                createDiagnosticLimiter(),
                false,
                {},
            ),
        ).toEqual([deadClassMessage('break-bogus', 'app/page.tsx')]);
    });

    it('is muted by CSSZYX_QUIET_SZ_WARNINGS, as the loader is', () => {
        expect(
            nextDeadClassLines(DEAD, createDiagnosticPolicy(), createDiagnosticLimiter(), false, {
                CSSZYX_QUIET_SZ_WARNINGS: '1',
            }),
        ).toEqual([]);
    });

    it('counts an info-level dead class in a production prebuild', () => {
        const policy = createDiagnosticPolicy({ rules: { 'dead-class': 'info' } });
        expect(nextDeadClassLines(DEAD, policy, createDiagnosticLimiter(), false, {})).toEqual([
            suppressedAdvisoryMessage(1),
        ]);
        expect(nextDeadClassLines(DEAD, policy, createDiagnosticLimiter(), true, {})).toEqual([
            deadClassMessage('break-bogus', 'app/page.tsx'),
        ]);
    });
});
