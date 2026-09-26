import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    buildSection,
    buildSquashBody,
    contentsPutRequest,
    expandedSquashMessage,
    expandSquashCommits,
    parseConventional,
    readCommitOverride,
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

    it('keeps the scoped entry when a PR title repeats it without a scope', () => {
        // A squash subject is the PR title, which often carries no scope while
        // the commit that did the work does. Both describe one change, and the
        // release notes should say it once, in the form that names the package.
        const entries = parseConventional([
            [
                'fix: name the defects a conditional resolves (#316)',
                '* fix(compiler): name the defects a conditional resolves',
            ].join('\n'),
        ]);

        assert.deepEqual(entries, [
            {
                type: 'fix',
                scope: 'compiler',
                desc: 'name the defects a conditional resolves',
                pr: '316',
                breaking: false,
                note: '',
            },
        ]);
    });

    it('keeps two scoped entries that share a description', () => {
        // Two packages fixed the same way in one pull request is two entries,
        // because each names a different package.
        const entries = parseConventional([
            [
                'feat: place a class the design system does not serve (#312)',
                '* feat(unplugin): place a class the design system does not serve',
                '* feat(runtime): place a class the design system does not serve',
            ].join('\n'),
        ]);

        assert.deepEqual(
            entries.map(entry => entry.scope),
            ['unplugin', 'runtime'],
        );
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

// The write that ships the enriched file. It used to pass the base64 of the
// whole CHANGELOG as a command-line argument, and Linux caps a SINGLE argument
// at MAX_ARG_STRLEN — 32 pages, 131_072 bytes. Measured on the v0.16.0 release
// PR: the payload reached 131_672 bytes, 608 over, and `gh` never ran. The
// release job reported success, because the enricher is best-effort and swallows
// what it catches, so the notes simply came out thin: one breaking change of
// two, and not one of the eight fixes.
describe('a pull request that overrides its commits', () => {
    const body = [
        'Some description.',
        '',
        'BEGIN_COMMIT_OVERRIDE',
        'feat(unplugin)!: merge a later sz key over an earlier one it covers',
        '',
        'BREAKING CHANGE: `{ pb: 2, p: 4 }` renders `p-4`.',
        '',
        'fix(runtime): keep a class no table signs',
        'END_COMMIT_OVERRIDE',
    ].join('\n');

    it('reads the block between the markers, and nothing without them', () => {
        assert.equal(
            readCommitOverride(body),
            [
                'feat(unplugin)!: merge a later sz key over an earlier one it covers',
                '',
                'BREAKING CHANGE: `{ pb: 2, p: 4 }` renders `p-4`.',
                '',
                'fix(runtime): keep a class no table signs',
            ].join('\n'),
        );
        assert.equal(readCommitOverride('no override here'), null);
        assert.equal(readCommitOverride('BEGIN_COMMIT_OVERRIDE\nfeat: never closed'), null);
        assert.equal(readCommitOverride(null), null);
    });

    // release-please reads the override in place of the whole squash message,
    // subject included; the notes must too, or a stale commit note the
    // override exists to replace comes back from the PR's own commits.
    it('replaces the title and every commit of the pull request', () => {
        const message = expandedSquashMessage('feat(unplugin)!: an old title (#329)', {
            body,
            commitMessages: ['feat(unplugin)!: a stale note\n\nBREAKING CHANGE: no longer true.'],
        });
        const entries = parseConventional([message]);

        assert.deepEqual(
            entries.map(e => [e.type, e.scope, e.desc, e.pr, e.breaking]),
            [
                [
                    'feat',
                    'unplugin',
                    'merge a later sz key over an earlier one it covers',
                    '329',
                    true,
                ],
                ['fix', 'runtime', 'keep a class no table signs', '329', false],
            ],
        );
        assert.equal(entries[0].note, '`{ pb: 2, p: 4 }` renders `p-4`.');
    });

    it('rebuilds from the commits when the pull request overrides nothing', () => {
        const message = expandedSquashMessage('feat: a title (#7)', {
            body: 'Just a description.',
            commitMessages: ['feat(cli): a commit'],
        });
        assert.equal(message, buildSquashBody('feat: a title (#7)', ['feat(cli): a commit']));
        assert.equal(
            expandedSquashMessage('feat: bare (#8)', { body: null, commitMessages: [] }),
            'feat: bare (#8)',
        );
        // A direct push names no pull request, so no body can override it.
        assert.equal(
            expandedSquashMessage('feat: pushed straight to main', { body, commitMessages: [] }),
            'feat: pushed straight to main',
        );
    });
});

describe('which override a pull request body carries', () => {
    const block = (lines: string[]) => lines.join('\n');

    it('reads markers only on lines of their own, outside a code fence', () => {
        assert.equal(
            readCommitOverride(
                block([
                    'To fix notes, paste:',
                    '```text',
                    'BEGIN_COMMIT_OVERRIDE',
                    'feat: an example',
                    'END_COMMIT_OVERRIDE',
                    '```',
                    'and mention BEGIN_COMMIT_OVERRIDE in prose.',
                ]),
            ),
            null,
        );
        assert.equal(
            readCommitOverride(
                block(['BEGIN_COMMIT_OVERRIDE feat: same line', 'END_COMMIT_OVERRIDE']),
            ),
            null,
        );
    });

    it('reads a body the web editor saved with CRLF line ends', () => {
        assert.equal(
            readCommitOverride(
                'BEGIN_COMMIT_OVERRIDE\r\nfeat(cli): one\r\nEND_COMMIT_OVERRIDE\r\n',
            ),
            'feat(cli): one',
        );
    });

    it('reads the first of two blocks, and an empty one as empty', () => {
        assert.equal(
            readCommitOverride(
                block([
                    'BEGIN_COMMIT_OVERRIDE',
                    'feat: first',
                    'END_COMMIT_OVERRIDE',
                    'BEGIN_COMMIT_OVERRIDE',
                    'feat: second',
                    'END_COMMIT_OVERRIDE',
                ]),
            ),
            'feat: first',
        );
        assert.equal(
            readCommitOverride(block(['BEGIN_COMMIT_OVERRIDE', '', 'END_COMMIT_OVERRIDE'])),
            '',
        );
    });
});

describe('expanding the squash commits of a release', () => {
    const override = 'BEGIN_COMMIT_OVERRIDE\nfeat(cli): the corrected note\nEND_COMMIT_OVERRIDE';
    const squash = [{ commit: { message: 'feat(cli): the title (#12)' } }];
    const commits = ['feat(cli): a stale note'];

    /**
     * Expand one squash with a fake GitHub and collect what it logged.
     *
     * @param pullRequest - What reading the pull request answers, or an error to throw.
     * @param commitMessages - What reading its commits answers, or an error to throw.
     * @returns The descriptions parsed from the result, and the log.
     */
    function expand(
        pullRequest: { body: string | null; trusted: boolean } | Error,
        commitMessages: string[] | Error = commits,
    ) {
        const log: string[] = [];
        const messages = expandSquashCommits(
            squash,
            {
                pullRequest: () => {
                    if (pullRequest instanceof Error) throw pullRequest;
                    return pullRequest;
                },
                commitMessages: () => {
                    if (commitMessages instanceof Error) throw commitMessages;
                    return commitMessages;
                },
            },
            (line: string) => log.push(line),
        );
        return { descs: parseConventional(messages).map(entry => entry.desc), log };
    }

    it('uses an override a maintainer wrote in place of the commits', () => {
        assert.deepEqual(expand({ body: override, trusted: true }).descs, ['the corrected note']);
    });

    // A pull request's author can edit its body after the merge, without write
    // access, and these notes are published to npm.
    it('keeps the commits when the body was last written by someone without write access', () => {
        const { descs, log } = expand({ body: override, trusted: false });
        assert.deepEqual(descs, ['the title', 'a stale note']);
        assert.match(log.join('\n'), /#12 .*write access/);
    });

    it('keeps the commits, and says so, when the override is empty', () => {
        const { descs, log } = expand({
            body: 'BEGIN_COMMIT_OVERRIDE\n\nEND_COMMIT_OVERRIDE',
            trusted: true,
        });
        assert.deepEqual(descs, ['the title', 'a stale note']);
        assert.match(log.join('\n'), /#12 .*empty/);
    });

    it('keeps the commits when there is no override or the body cannot be read', () => {
        assert.deepEqual(expand({ body: 'A description.', trusted: true }).descs, [
            'the title',
            'a stale note',
        ]);
        assert.deepEqual(expand(new Error('rate limited')).descs, ['the title', 'a stale note']);
    });

    it('keeps the squash message when neither can be read', () => {
        const { descs } = expand(new Error('down'), new Error('down'));
        assert.deepEqual(descs, ['the title']);
    });

    it('asks nothing for a commit pushed without a pull request', () => {
        const messages = expandSquashCommits(
            [{ commit: { message: 'fix: pushed straight to main' } }],
            {
                pullRequest: () => assert.fail('no pull request to read'),
                commitMessages: () => assert.fail('no pull request to read'),
            },
            () => {},
        );
        assert.deepEqual(messages, ['fix: pushed straight to main']);
    });
});

describe('the request that writes the changelog back', () => {
    /** Linux `MAX_ARG_STRLEN`: the cap on one argument, not on the whole list. */
    const SINGLE_ARGUMENT_CAP = 32 * 4096;

    it('keeps a changelog far past the argument cap out of argv', () => {
        const content = 'x'.repeat(400_000);
        const { args, input } = contentsPutRequest({
            repo: 'owner/repo',
            path: 'packages/csszyx/CHANGELOG.md',
            message: 'docs: enrich 1.2.3 release notes from squash commits',
            content,
            sha: 'abc123',
            branch: 'release-please--branches--main--components--csszyx',
        });

        const longest = Math.max(...args.map(argument => argument.length));
        assert.ok(
            longest < SINGLE_ARGUMENT_CAP,
            `longest argument is ${longest} bytes, at or past the ${SINGLE_ARGUMENT_CAP} cap`,
        );
        assert.ok(args.every(argument => !argument.includes(content)));
        assert.equal(JSON.parse(input).content, Buffer.from(content).toString('base64'));
    });

    it('carries every field the contents API needs', () => {
        const { args, input } = contentsPutRequest({
            repo: 'owner/repo',
            path: 'CHANGELOG.md',
            message: 'msg',
            content: 'hello',
            sha: 'sha1',
            branch: 'br',
        });

        assert.deepEqual(args, [
            'api',
            '-X',
            'PUT',
            'repos/owner/repo/contents/CHANGELOG.md',
            '--input',
            '-',
        ]);
        assert.deepEqual(JSON.parse(input), {
            message: 'msg',
            content: Buffer.from('hello').toString('base64'),
            sha: 'sha1',
            branch: 'br',
        });
    });
});
