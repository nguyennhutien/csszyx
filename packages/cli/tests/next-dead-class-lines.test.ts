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
    underscoreSpaceMessage,
    unsignedValueMessage,
} from '@csszyx/unplugin/diagnostics';
import { describe, expect, it } from 'vitest';

import { nextDeadClassLines } from '../src/commands/next-diagnostic-policy.js';

const DEAD = [{ className: 'break-bogus', file: 'app/page.tsx' }];

describe('nextDeadClassLines', () => {
    it('lists a dead class at the default level', () => {
        expect(
            nextDeadClassLines(
                { dead: DEAD },
                createDiagnosticPolicy(),
                createDiagnosticLimiter(),
                false,
                {},
            ),
        ).toEqual([deadClassMessage('break-bogus', 'app/page.tsx')]);
    });

    it('is muted by CSSZYX_QUIET_SZ_WARNINGS, as the loader is', () => {
        expect(
            nextDeadClassLines(
                { dead: DEAD },
                createDiagnosticPolicy(),
                createDiagnosticLimiter(),
                false,
                {
                    CSSZYX_QUIET_SZ_WARNINGS: '1',
                },
            ),
        ).toEqual([]);
    });

    it('counts an info-level dead class in a production prebuild', () => {
        const policy = createDiagnosticPolicy({ rules: { 'dead-class': 'info' } });
        expect(
            nextDeadClassLines({ dead: DEAD }, policy, createDiagnosticLimiter(), false, {}),
        ).toEqual([suppressedAdvisoryMessage(1)]);
        expect(
            nextDeadClassLines({ dead: DEAD }, policy, createDiagnosticLimiter(), true, {}),
        ).toEqual([deadClassMessage('break-bogus', 'app/page.tsx')]);
    });

    it('says a dead class with a hoisted sign once, as unsigned-value', () => {
        expect(
            nextDeadClassLines(
                { dead: [{ className: 'hover:-p-2', unsigned: 'p-2', file: 'app/page.tsx' }] },
                createDiagnosticPolicy(),
                createDiagnosticLimiter(),
                false,
                {},
            ),
        ).toEqual([unsignedValueMessage('hover:-p-2', 'p-2', 'app/page.tsx')]);
    });

    it('says an `_` read as a space after the dead classes, and counts both when held', () => {
        const underscore = [
            {
                key: 'content',
                value: "'a_b'",
                className: "content-['a_b']",
                file: 'app/page.tsx',
                line: 2,
                column: 9,
                literal: `"'a_b'"`,
                spaced: `"'a b'"`,
                escaped: `"'a\\\\_b'"`,
            },
        ];
        const lines = nextDeadClassLines(
            { dead: DEAD, underscore },
            createDiagnosticPolicy(),
            createDiagnosticLimiter(),
            false,
            {},
        );
        expect(lines).toEqual([
            deadClassMessage('break-bogus', 'app/page.tsx'),
            underscoreSpaceMessage(underscore[0]),
        ]);
        const held = createDiagnosticPolicy({
            rules: { 'dead-class': 'info', 'underscore-space': 'info' },
        });
        expect(
            nextDeadClassLines(
                { dead: DEAD, underscore },
                held,
                createDiagnosticLimiter(),
                false,
                {},
            ),
        ).toEqual([suppressedAdvisoryMessage(2)]);
    });
});
