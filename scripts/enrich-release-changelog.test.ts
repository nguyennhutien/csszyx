import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    buildSection,
    buildSquashBody,
    parseConventional,
    spliceSection,
} from './enrich-release-changelog.mjs';

describe('release changelog enrichment', () => {
    // The body GitHub would have written if it had not stopped at 64 KiB. The
    // shape is load-bearing: the PR reference is read off the first line and
    // applied to everything below it, and a footer attaches to the bullet above
    // it — so this is asserted by parsing it back, not by string comparison.
    it('rebuilds a squash body that parses like the real thing', () => {
        const body = buildSquashBody('feat!: bundle the lot (#99)', [
            'feat(runtime): add a thing',
            'fix(compiler): stop dropping a value\n\nBREAKING CHANGE: `parse()` takes an options object.',
            '   ',
        ]);

        const entries = parseConventional([body]);

        assert.deepEqual(
            entries.map(e => [e.type, e.scope, e.desc, e.pr, e.breaking]),
            [
                ['feat', '', 'bundle the lot', '99', true],
                ['feat', 'runtime', 'add a thing', '99', false],
                ['fix', 'compiler', 'stop dropping a value', '99', true],
            ],
        );
        assert.equal(entries[2].note, '`parse()` takes an options object.');
    });

    it('leaves a subject alone when the pull request has no commits to read', () => {
        assert.equal(buildSquashBody('chore: nothing (#1)', []), 'chore: nothing (#1)');
    });

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
            {
                type: 'feat',
                scope: 'runtime',
                desc: 'merge utility classes',
                pr: '42',
                breaking: true,
                // No footer, so the description IS the note.
                note: 'merge utility classes',
            },
            {
                type: 'fix',
                scope: 'compiler',
                desc: 'preserve falsy values',
                pr: '42',
                breaking: false,
                note: '',
            },
        ]);
    });

    it('lifts a BREAKING CHANGE footer onto the bullet above it', () => {
        // The shape a squash body actually has: the footer sits in the body
        // below its bullet, several lines down and wrapped. 0.12.0 shipped
        // with both markers present and neither reaching the changelog.
        const entries = parseConventional([
            [
                'feat!: bundled release (#190)',
                '',
                '* feat(unplugin)!: make class mangling opt-in',
                '',
                'Some prose about the change.',
                '',
                'BREAKING CHANGE: production.mangle now defaults to false. Set',
                '`production: { mangle: true }` to restore it.',
                '',
                '* perf(core): unrelated follow-up',
            ].join('\n'),
        ]);

        const mangle = entries.find(entry => entry.scope === 'unplugin');
        assert.equal(mangle?.breaking, true);
        assert.equal(
            mangle?.note,
            'production.mangle now defaults to false. Set `production: { mangle: true }` to restore it.',
        );
        // The footer must not bleed onto the next bullet.
        assert.equal(entries.find(entry => entry.scope === 'core')?.breaking, false);
    });

    it('renders breaking changes first, using the note over the subject', () => {
        const entries = parseConventional([
            [
                'feat(unplugin)!: make class mangling opt-in (#190)',
                '',
                'BREAKING CHANGE: production.mangle now defaults to false.',
            ].join('\n'),
        ]);
        const section = buildSection(
            '## [0.12.0] (2026-08-03)',
            entries,
            new Map([['feat', 'Features']]),
            'https://github.com/example/repo',
        );

        assert.match(section, /### ⚠ BREAKING CHANGES/);
        assert.match(section, /\* \*\*unplugin:\*\* production\.mangle now defaults to false\./);
        assert.ok(
            section.indexOf('BREAKING CHANGES') < section.indexOf('### Features'),
            'breaking section must precede the feature list',
        );
    });

    it('omits the breaking section when nothing breaks', () => {
        const entries = parseConventional(['fix(cli): safer migration (#7)']);
        const section = buildSection(
            '## [1.2.0] (2026-07-15)',
            entries,
            new Map([['fix', 'Bug Fixes']]),
            'https://github.com/example/repo',
        );
        assert.doesNotMatch(section, /BREAKING/);
    });

    it('does not mistake malformed PR suffixes or subjects for entries', () => {
        assert.deepEqual(
            parseConventional(['fix: keep literal suffix (#abc)\nfix(): invalid\nfix:']),
            [
                {
                    type: 'fix',
                    scope: '',
                    desc: 'keep literal suffix (#abc)',
                    pr: null,
                    breaking: false,
                    note: '',
                },
            ],
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
