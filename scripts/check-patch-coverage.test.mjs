import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    isMeasurable,
    parseArgs,
    parseDiffHunks,
    repoRelativeSource,
} from './check-patch-coverage.mjs';

describe('patch coverage', () => {
    it('reads the added lines out of a zero-context hunk header', () => {
        const diff = [
            '--- a/packages/cli/src/a.ts',
            '+++ b/packages/cli/src/a.ts',
            '@@ -10,0 +11,3 @@',
            '+one',
            '+two',
            '+three',
        ].join('\n');

        assert.deepEqual([...parseDiffHunks(diff).get('packages/cli/src/a.ts')], [11, 12, 13]);
    });

    it('treats a hunk header without a count as one line', () => {
        // `@@ -4 +4 @@` is what git writes for a single-line replacement, and
        // reading the missing count as zero would skip the only changed line.
        const diff = ['+++ b/x.ts', '@@ -4 +4 @@', '+changed'].join('\n');

        assert.deepEqual([...parseDiffHunks(diff).get('x.ts')], [4]);
    });

    it('collects every hunk in a file, not only the first', () => {
        const diff = ['+++ b/x.ts', '@@ -1 +1 @@', '+a', '@@ -9,0 +10,2 @@', '+b', '+c'].join('\n');

        assert.deepEqual([...parseDiffHunks(diff).get('x.ts')], [1, 10, 11]);
    });

    it('ignores a deleted file, which has no added lines to cover', () => {
        const diff = ['--- a/gone.ts', '+++ /dev/null', '@@ -1,3 +0,0 @@'].join('\n');

        assert.equal(parseDiffHunks(diff).size, 0);
    });

    it('counts source as measurable and everything untestable as not', () => {
        assert.ok(isMeasurable('packages/cli/src/commands/check.ts'));
        assert.ok(isMeasurable('packages/core/src/transform/parser.rs'));

        // Each of these would otherwise be reported as an uncovered gap in a
        // file no coverage run was ever asked to measure.
        assert.ok(!isMeasurable('packages/cli/tests/check.test.ts'));
        assert.ok(!isMeasurable('packages/cli/src/thing.test.ts'));
        assert.ok(!isMeasurable('packages/types/src/index.ts'));
        assert.ok(!isMeasurable('packages/core/scripts/build-native.mjs'));
        assert.ok(!isMeasurable('packages/cli/src/index.d.ts'));
        assert.ok(!isMeasurable('docs/config/overview.md'));
        assert.ok(!isMeasurable('package.json'));
    });

    it('resolves a package-relative source path against its own report', () => {
        // The ts-plugin report runs inside its package, so it says `src/…` for
        // a file the diff calls `packages/ts-plugin/src/…`. Keying on the raw
        // path matches nothing, which reads as a fully covered package.
        assert.equal(
            repoRelativeSource('src/index.ts', 'packages/ts-plugin/coverage/lcov.info'),
            'packages/ts-plugin/src/index.ts',
        );
    });

    it('leaves a path it cannot resolve alone rather than guessing', () => {
        // Reported under its raw name keeps it visible; rewriting it to
        // something plausible would file it against a source that never moved.
        assert.equal(
            repoRelativeSource('nowhere/absent.ts', 'coverage/lcov.info'),
            'nowhere/absent.ts',
        );
    });

    it('defaults the base to the main branch and the reports to the CI set', () => {
        const parsed = parseArgs([]);

        assert.equal(parsed.base, 'origin/main');
        assert.ok(parsed.reports.includes('coverage/lcov.info'));
        assert.ok(parsed.reports.includes('coverage/rust-lcov.info'));
    });

    it('takes an explicit base and replaces the report list rather than adding to it', () => {
        const parsed = parseArgs(['--base=HEAD~1', '--report=/tmp/one.info']);

        assert.equal(parsed.base, 'HEAD~1');
        assert.deepEqual(parsed.reports, ['/tmp/one.info']);
    });
});
