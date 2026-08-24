import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    isMeasurable,
    parseArgs,
    parseDiffHunks,
    parseLcov,
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

    it('counts .rs as measurable so a missing rust report cannot read as coverage', () => {
        // The report and the check are separate steps, and the check has to be
        // able to tell "this language was never measured" from "this file has
        // no test" — they call for opposite fixes.
        assert.ok(isMeasurable('packages/core/src/transform/parser.rs'));
    });

    it('exempts the napi bindings, which the coverage run does not compile', () => {
        // `cov:rust` builds with `native-engine,migrate`; the bindings sit
        // behind `native`, so no report can mention them however well they are
        // tested — and they are, through the built addon. This entry stops
        // being right the moment that feature list gains `native`.
        assert.ok(!isMeasurable('packages/core/src/native.rs'));
    });

    it('exempts a rust file with no function, which has nothing to execute', () => {
        // A module that only lists its submodules and re-exports them gets no
        // record from llvm-cov. Keyed on the absence of a function rather than
        // on the file name, so a module that grows one is measured again.
        const asModule = () => 'mod a;\npub use a::B;\n';
        const asCode = () => 'pub fn f() -> u8 { 1 }\n';
        assert.ok(!isMeasurable('packages/core/src/migrate/mod.rs', asModule));
        assert.ok(isMeasurable('packages/core/src/migrate/mod.rs', asCode));
    });

    it('exempts a package config, which sits beside src and is never executed', () => {
        assert.ok(!isMeasurable('packages/compiler/build.config.ts'));
        assert.ok(isMeasurable('packages/compiler/src/index.ts'));
    });

    it('defaults the base to the main branch and the reports to the CI set', () => {
        const parsed = parseArgs([]);

        assert.equal(parsed.base, 'origin/main');
        assert.ok(parsed.reports.includes('coverage/lcov.info'));
        assert.ok(parsed.reports.includes('coverage/rust-lcov.info'));
    });

    it('counts a line whose branches are not all taken as uncovered', () => {
        // Codecov calls this a "partial" and its line metric scores it as
        // uncovered — codecov.yml says so in its own comment. A gate that read
        // only DA records would call this covered and disagree with the service
        // it exists to predict, which is the whole failure mode here.
        const records = parseLcov(
            'SF:packages/x/src/a.ts\nDA:10,5\nBRDA:10,0,0,5\nBRDA:10,0,1,0\nend_of_record\n',
            'coverage/lcov.info',
        );

        assert.ok(records.get('packages/x/src/a.ts').uncovered.has(10));
        assert.ok(!records.get('packages/x/src/a.ts').covered.has(10));
    });

    it('leaves a line whose branches are all taken covered', () => {
        const records = parseLcov(
            'SF:packages/x/src/a.ts\nDA:10,5\nBRDA:10,0,0,5\nBRDA:10,0,1,2\nend_of_record\n',
            'coverage/lcov.info',
        );

        assert.ok(records.get('packages/x/src/a.ts').covered.has(10));
        assert.ok(!records.get('packages/x/src/a.ts').uncovered.has(10));
    });

    it('counts a partial line the report gives no hit record for as uncovered', () => {
        // v8 writes one DA record per statement, so a branch inside a
        // multi-line expression is reported against a line the hit map never
        // mentions. Building the line set from DA records alone drops such a
        // line from both answers, and a gate that reports on what it collected
        // then stays silent about a branch it was handed.
        const records = parseLcov(
            'SF:packages/x/src/a.ts\nDA:10,5\nBRDA:12,7,0,5\nBRDA:12,7,1,0\nend_of_record\n',
            'coverage/lcov.info',
        );

        assert.ok(records.get('packages/x/src/a.ts').uncovered.has(12));
        assert.ok(!records.get('packages/x/src/a.ts').covered.has(12));
    });

    it('reads a dash branch count as not taken', () => {
        // lcov writes `-` when a branch was never reached at all, which is
        // strictly worse than reached-and-not-taken.
        const records = parseLcov(
            'SF:packages/x/src/a.ts\nDA:10,5\nBRDA:10,0,0,-\nend_of_record\n',
            'coverage/lcov.info',
        );

        assert.ok(records.get('packages/x/src/a.ts').uncovered.has(10));
    });

    it('takes an explicit base and replaces the report list rather than adding to it', () => {
        const parsed = parseArgs(['--base=HEAD~1', '--report=/tmp/one.info']);

        assert.equal(parsed.base, 'HEAD~1');
        assert.deepEqual(parsed.reports, ['/tmp/one.info']);
    });
});
