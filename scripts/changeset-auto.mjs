#!/usr/bin/env node
// Generate a changeset draft from Conventional Commits since the last release.
//
// The script is ASSISTIVE, not authoritative. It parses `git log <from>..<to>`
// into a structured draft so developers do not need to retype commit content
// when creating a changeset. The developer is expected to review, edit wording,
// drop internal items, and add migration guides before committing.
//
// Usage:
//   pnpm changeset:auto                         # draft from last tag..HEAD
//   pnpm changeset:auto --dry-run               # print to stdout, no file
//   pnpm changeset:auto --from=<ref> --to=<ref> # explicit range
//   pnpm changeset:auto --bump=major            # override bump level
//   pnpm changeset:auto --pkg=@csszyx/foo       # override package (default: csszyx)
//
// Design notes:
//   - Handles GitHub squash merges: when a commit body contains `* type(scope): ...`
//     sub-items, those are extracted as primary entries (the squash subject is
//     usually just "v0.4.0 — summary" and would otherwise swallow 15 sub-commits).
//   - Detects breaking changes via `!` marker (feat!, fix!) and `BREAKING CHANGE:`
//     footer. Bump level escalates accordingly (breaking → major, feat → minor,
//     else patch) unless --bump overrides.
//   - Short commit hashes are appended to each bullet for traceability. Developer
//     can strip them during review if the CHANGELOG should be non-technical.

import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, readdirSync } from 'node:fs';

const SEP_REC = '\x1e';
const SEP_FIELD = '\x1f';

const CONV_RE =
    /^(revert:\s+)?(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;
const BREAKING_BODY_RE = /^BREAKING[ -]CHANGE:/m;
const BODY_ITEM_RE = /^\*\s+(.+)$/;

const ARGS = parseArgs(process.argv.slice(2));
const DRY = ARGS['dry-run'] === true;
const FROM = ARGS.from ?? detectLastReleaseRef();
const TO = ARGS.to ?? 'HEAD';
const BUMP_OVERRIDE = ARGS.bump;
const PKG = ARGS.pkg ?? 'csszyx';

function parseArgs(argv) {
    const out = {};
    for (const a of argv) {
        if (a === '--dry-run') {
            out['dry-run'] = true;
            continue;
        }
        if (!a.startsWith('--')) continue;
        const eq = a.indexOf('=');
        if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
        else out[a.slice(2)] = true;
    }
    return out;
}

function detectLastReleaseRef() {
    try {
        return execSync('git describe --tags --abbrev=0', {
            stdio: ['pipe', 'pipe', 'ignore'],
        })
            .toString()
            .trim();
    } catch {
        console.error(
            '[changeset:auto] No tags found. Pass --from=<ref> explicitly.',
        );
        process.exit(1);
    }
}

function getCommits(from, to) {
    const fmt = `%H${SEP_FIELD}%s${SEP_FIELD}%b${SEP_REC}`;
    const raw = execSync(`git log ${from}..${to} --format=${fmt}`, {
        maxBuffer: 32 * 1024 * 1024,
    }).toString();
    return raw
        .split(SEP_REC)
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => {
            const parts = c.split(SEP_FIELD);
            const hash = parts[0] ?? '';
            const subject = parts[1] ?? '';
            const body = parts[2] ?? '';
            return { hash: hash.slice(0, 7), subject, body };
        });
}

function parseConventional(text) {
    const m = text.match(CONV_RE);
    if (!m) return null;
    const [, revert, type, scope, bang, desc] = m;
    return {
        revert: !!revert,
        type,
        scope: scope ?? '',
        bang: !!bang,
        desc: desc.trim(),
    };
}

function extractEntries(commits) {
    const entries = [];
    for (const c of commits) {
        const subj = parseConventional(c.subject);
        const bodyHasBreaking = BREAKING_BODY_RE.test(c.body);

        const bodyItems = c.body
            .split('\n')
            .map((l) => l.match(BODY_ITEM_RE))
            .filter(Boolean)
            .map((m) => parseConventional(m[1]))
            .filter(Boolean);

        if (bodyItems.length > 0) {
            // Squash merge: body sub-items become the primary entries.
            for (const item of bodyItems) {
                entries.push({
                    ...item,
                    breaking: item.bang || bodyHasBreaking,
                    hash: c.hash,
                });
            }
            continue;
        }

        if (subj) {
            entries.push({
                ...subj,
                breaking: subj.bang || bodyHasBreaking,
                hash: c.hash,
            });
            continue;
        }

        entries.push({
            revert: false,
            type: 'other',
            scope: '',
            bang: false,
            desc: c.subject,
            breaking: false,
            hash: c.hash,
        });
    }
    return entries;
}

function group(entries) {
    const buckets = {
        breaking: [],
        feat: [],
        fix: [],
        perf: [],
        docs: [],
        refactor: [],
        other: [],
    };
    for (const e of entries) {
        if (e.breaking) buckets.breaking.push(e);
        else if (e.type === 'feat') buckets.feat.push(e);
        else if (e.type === 'fix') buckets.fix.push(e);
        else if (e.type === 'perf') buckets.perf.push(e);
        else if (e.type === 'docs') buckets.docs.push(e);
        else if (e.type === 'refactor') buckets.refactor.push(e);
        else buckets.other.push(e);
    }
    return buckets;
}

function decideBump(buckets) {
    if (BUMP_OVERRIDE) return BUMP_OVERRIDE;
    if (buckets.breaking.length) return 'major';
    if (buckets.feat.length) return 'minor';
    return 'patch';
}

function renderBullet(e) {
    const scope = e.scope ? `**${e.scope}:** ` : '';
    const revert = e.revert ? '_(revert)_ ' : '';
    return `- ${scope}${revert}${e.desc} (${e.hash})`;
}

function renderSection(title, items) {
    if (items.length === 0) return '';
    return `\n### ${title}\n\n${items.map(renderBullet).join('\n')}\n`;
}

function render(buckets, bump) {
    const header = [
        '<!-- Auto-generated draft — review before committing:',
        '       • rewrite wording for end users',
        '       • drop internal items (CI, chore, refactor) not worth public release notes',
        '       • add Migration subsection under each ⚠️ Breaking Change bullet',
        '       • remove short hashes if the final CHANGELOG should be non-technical',
        '-->',
    ].join('\n');
    const summary = 'TODO: one-line summary — rewrite this';
    const body =
        renderSection('⚠️ Breaking Changes', buckets.breaking) +
        renderSection('Features', buckets.feat) +
        renderSection('Fixes', buckets.fix) +
        renderSection('Performance', buckets.perf) +
        renderSection('Documentation', buckets.docs) +
        renderSection('Refactors', buckets.refactor) +
        renderSection('Other', buckets.other);
    return `---\n"${PKG}": ${bump}\n---\n\n${header}\n\n${summary}\n${body}`;
}

function warnIfExistingDrafts() {
    try {
        const files = readdirSync('.changeset').filter(
            (f) => f.startsWith('auto-') && f.endsWith('.md'),
        );
        if (files.length > 0) {
            console.error(
                `[changeset:auto] Warning: existing draft(s) found in .changeset/:\n  ${files.join('\n  ')}\n  Review or delete before committing.`,
            );
        }
    } catch {
        // .changeset/ may not exist yet; ignore.
    }
}

const commits = getCommits(FROM, TO);
if (commits.length === 0) {
    console.error(`[changeset:auto] No commits between ${FROM}..${TO}.`);
    process.exit(1);
}

const entries = extractEntries(commits);
const buckets = group(entries);
const bump = decideBump(buckets);
const content = render(buckets, bump);

if (DRY) {
    process.stdout.write(content + '\n');
    process.exit(0);
}

warnIfExistingDrafts();
const filename = `.changeset/auto-${Date.now().toString(36)}.md`;
if (existsSync(filename)) {
    console.error(`[changeset:auto] File exists, aborting: ${filename}`);
    process.exit(1);
}
writeFileSync(filename, content);

console.error(`[changeset:auto] ✓ Draft: ${filename}`);
console.error(`  Bump:    ${bump}${BUMP_OVERRIDE ? ' (forced)' : ''}`);
console.error(`  Range:   ${FROM}..${TO}`);
console.error(`  Commits: ${commits.length}`);
console.error(
    `  Entries: ${entries.length} (${buckets.breaking.length} breaking, ${buckets.feat.length} feat, ${buckets.fix.length} fix)`,
);
console.error('');
console.error(
    '  Next: open the file, review + edit, then git add + commit as usual.',
);
