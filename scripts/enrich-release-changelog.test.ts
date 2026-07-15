import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildSection, parseConventional, spliceSection } from './enrich-release-changelog.mjs';

describe('release changelog enrichment', () => {
    it('parses scoped, breaking, and squash-body entries without duplicates', () => {
        const entries = parseConventional([
            [
                'feat(runtime)!: merge utility classes (#42)',
                '* fix(compiler): preserve falsy values (#41)',
                '* feat(runtime)!: merge utility classes',
                '* not-a-type: ignore me',
            ].join('\n'),
        ]);

        assert.deepEqual(entries, [
            { type: 'feat', scope: 'runtime', desc: 'merge utility classes', pr: '42' },
            { type: 'fix', scope: 'compiler', desc: 'preserve falsy values', pr: '42' },
        ]);
    });

    it('does not mistake malformed PR suffixes or subjects for entries', () => {
        assert.deepEqual(
            parseConventional(['fix: keep literal suffix (#abc)\nfix(): invalid\nfix:']),
            [{ type: 'fix', scope: '', desc: 'keep literal suffix (#abc)', pr: null }],
        );
    });

    it('builds grouped markdown and replaces only the requested version', () => {
        const entries = parseConventional(['fix(cli): safer migration (#7)']);
        const section = buildSection(
            '## [1.2.0] (2026-07-15)',
            entries,
            new Map([['fix', 'Bug Fixes']]),
            'https://github.com/example/repo',
        );
        const changelog = '# Changelog\n\n## [1.2.0] (old)\n\nold\n\n## [1.1.0] (old)\n\nkeep\n';
        const updated = spliceSection(changelog, '1.2.0', section);

        assert.match(updated, /### Bug Fixes/);
        assert.match(updated, /\[#7\]\(https:\/\/github\.com\/example\/repo\/issues\/7\)/);
        assert.match(updated, /## \[1\.1\.0\] \(old\)\n\nkeep\n$/);
        assert.equal(updated.endsWith('\n\n'), false);
    });
});
