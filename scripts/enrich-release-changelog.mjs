#!/usr/bin/env node
/**
 * Auto-enrich the release-please CHANGELOG (and release PR body) from the squash
 * commit bodies.
 *
 * Why: the repo squash-merges, so release-please sees one commit per PR and
 * writes a single CHANGELOG line (the PR title). The squash body carries every
 * conventional commit (squash_merge_commit_message = COMMIT_MESSAGES), but
 * release-please ignores it. This re-builds the version's CHANGELOG section from
 * those bodies so a bundled PR still produces rich, grouped notes.
 *
 * Runs in release.yml after release-please, only when a release PR is open. It is
 * best-effort: any failure logs and exits 0 so a release is never broken — the
 * worst case is the thin release-please output.
 *
 * Pure helpers (parseConventional, buildSection, spliceSection) are exported for
 * tests; main() does the gh API glue.
 *
 * @module
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');

/**
 * Build a type→section map from release-please-config changelog-sections,
 * dropping hidden types so the enriched notes match release-please's grouping.
 * @param {{ ['changelog-sections']?: Array<{ type: string, section?: string, hidden?: boolean }> }} config - Parsed release-please config.
 * @returns {Map<string, string>} Map of conventional type to section title.
 */
export function loadSections(config) {
    const map = new Map();
    for (const s of config['changelog-sections'] ?? []) {
        if (!s.hidden && s.type && s.section) {
            map.set(s.type, s.section);
        }
    }
    return map;
}

const CONVENTIONAL_TYPES = new Set([
    'feat',
    'fix',
    'perf',
    'revert',
    'refactor',
    'test',
    'ci',
    'build',
    'chore',
    'docs',
    'style',
]);

/**
 * Remove a trailing `(#123)` reference without a backtracking regex.
 * @param {string} text - Subject or description text.
 * @returns {{ text: string, pr: string | null }} Clean text and PR number.
 */
function readTrailingPr(text) {
    const trimmed = text.trimEnd();
    if (!trimmed.endsWith(')')) return { text: trimmed, pr: null };
    const marker = trimmed.lastIndexOf('(#');
    if (marker === -1) return { text: trimmed, pr: null };
    const pr = trimmed.slice(marker + 2, -1);
    if (pr === '' || [...pr].some(character => character < '0' || character > '9')) {
        return { text: trimmed, pr: null };
    }
    return { text: trimmed.slice(0, marker).trimEnd(), pr };
}

/**
 * Parse one conventional subject after bullet decoration has been removed.
 * @param {string} line - Candidate conventional subject.
 * @returns {{ type: string, scope: string, desc: string } | null} Parsed entry.
 */
function parseConventionalLine(line) {
    const colon = line.indexOf(':');
    if (colon <= 0) return null;

    let header = line.slice(0, colon);
    const desc = line.slice(colon + 1).trimStart();
    if (desc === '') return null;
    if (header.endsWith('!')) header = header.slice(0, -1);

    const open = header.indexOf('(');
    const type = open === -1 ? header : header.slice(0, open);
    if (!CONVENTIONAL_TYPES.has(type)) return null;
    if (open === -1) return { type, scope: '', desc };
    if (!header.endsWith(')')) return null;

    const scope = header.slice(open + 1, -1);
    if (scope === '' || scope.includes(')')) return null;
    return { type, scope, desc };
}

/**
 * Extract deduped conventional-commit entries from a list of commit messages.
 * Reads the subject and every body line (squash bodies list each commit as a
 * `* type(scope): desc` bullet), tagging each entry with the squash's PR number.
 * @param {string[]} messages - Full commit messages (subject + body).
 * @returns {Array<{ type: string, scope: string, desc: string, pr: string | null }>} Parsed entries in first-seen order.
 */
export function parseConventional(messages) {
    const seen = new Set();
    const out = [];
    for (const message of messages) {
        const firstLine = message.split('\n', 1)[0] ?? '';
        const pr = readTrailingPr(firstLine).pr;
        for (const raw of message.split('\n')) {
            const line = raw.trim().replace(/^[*-]\s+/, '');
            const parsed = parseConventionalLine(line);
            if (!parsed) continue;
            const { type, scope } = parsed;
            const desc = readTrailingPr(parsed.desc).text.trim();
            const key = `${type}|${scope}|${desc}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            out.push({ type, scope, desc, pr });
        }
    }
    return out;
}

/**
 * Render the markdown body of a version's CHANGELOG section (grouped by section,
 * hidden types dropped). The caller supplies the existing `## [x] (date)` header
 * to preserve release-please's compare link and date.
 * @param {string} header - The existing `## [version](...) (date)` line.
 * @param {ReturnType<typeof parseConventional>} entries - Parsed entries.
 * @param {Map<string, string>} sectionMap - type→section title.
 * @param {string} repoUrl - e.g. https://github.com/owner/repo (for PR links).
 * @returns {string} The full section markdown (header + grouped entries).
 */
export function buildSection(header, entries, sectionMap, repoUrl) {
    const order = [...new Set(sectionMap.values())];
    const bySection = new Map();
    for (const e of entries) {
        const section = sectionMap.get(e.type);
        if (!section) {
            continue;
        }
        if (!bySection.has(section)) {
            bySection.set(section, []);
        }
        bySection.get(section).push(e);
    }
    let md = `${header}\n`;
    for (const section of order) {
        const list = bySection.get(section);
        if (!list?.length) {
            continue;
        }
        md += `\n\n### ${section}\n\n`;
        md += list
            .map(e => {
                const scope = e.scope ? `**${e.scope}:** ` : '';
                const link = e.pr ? ` ([#${e.pr}](${repoUrl}/issues/${e.pr}))` : '';
                return `* ${scope}${e.desc}${link}`;
            })
            .join('\n');
    }
    return md;
}

/**
 * Replace the section for `version` in a CHANGELOG with `newSection`, preserving
 * everything before and after it. Returns the original text unchanged when the
 * version header is not found.
 * @param {string} changelog - Full CHANGELOG.md text.
 * @param {string} version - Version to replace, e.g. "0.9.5".
 * @param {string} newSection - Replacement section markdown (no trailing blank).
 * @returns {string} Updated CHANGELOG text.
 */
export function spliceSection(changelog, version, newSection) {
    const lines = changelog.split('\n');
    const startToken = `## [${version}]`;
    const start = lines.findIndex(l => l.startsWith(startToken));
    if (start === -1) {
        return changelog;
    }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (lines[i].startsWith('## [')) {
            end = i;
            break;
        }
    }
    const before = lines.slice(0, start);
    const after = lines.slice(end);
    return [...before, ...newSection.split('\n'), '', ...after]
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd()
        .concat('\n');
}

/**
 * gh API helper — returns parsed JSON (or text) for a path/args.
 * @param {string[]} args - Arguments to `gh`.
 * @returns {string} stdout.
 */
function gh(args) {
    return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Best-effort entry point. Reads the open release PR, rebuilds its CHANGELOG
 * section from the commit range since the last release, and updates both the
 * CHANGELOG on the release branch and the PR body. Never throws.
 */
async function main() {
    try {
        const repo = process.env.GH_REPO;
        if (!repo) {
            console.log('[enrich] GH_REPO unset — skipping');
            return;
        }
        // The release branch shape depends on release-please config
        // (separate-pull-requests appends --components--<name>), so resolve
        // it from the open release PR instead of hardcoding one shape.
        let branch = process.env.RELEASE_BRANCH;
        if (!branch) {
            const open = JSON.parse(gh(['api', `repos/${repo}/pulls?state=open&per_page=50`]));
            branch = open.find(p => p.head.ref.startsWith('release-please--branches--main'))?.head
                .ref;
        }
        if (!branch) {
            console.log('[enrich] no open release PR branch found — skipping');
            return;
        }
        const repoUrl = `https://github.com/${repo}`;
        const sectionMap = loadSections(
            JSON.parse(readFileSync(path.join(ROOT, 'release-please-config.json'), 'utf8')),
        );

        const version = JSON.parse(
            Buffer.from(
                JSON.parse(
                    gh([
                        'api',
                        `repos/${repo}/contents/.release-please-manifest.json?ref=${branch}`,
                    ]),
                ).content,
                'base64',
            ).toString('utf8'),
        )['.'];
        if (!version) {
            console.log('[enrich] no manifest version — skipping');
            return;
        }

        const lastTag = JSON.parse(gh(['api', `repos/${repo}/releases/latest`])).tag_name;
        const compare = JSON.parse(gh(['api', `repos/${repo}/compare/${lastTag}...main`]));
        const messages = (compare.commits ?? []).map(c => c.commit.message);
        const entries = parseConventional(messages);
        if (!entries.some(e => sectionMap.has(e.type))) {
            console.log('[enrich] no visible entries — leaving release-please output as-is');
            return;
        }

        const changelogMeta = JSON.parse(
            gh(['api', `repos/${repo}/contents/packages/csszyx/CHANGELOG.md?ref=${branch}`]),
        );
        const changelog = Buffer.from(changelogMeta.content, 'base64').toString('utf8');
        const header = changelog.split('\n').find(l => l.startsWith(`## [${version}]`));
        if (!header) {
            console.log(`[enrich] no section for ${version} — skipping`);
            return;
        }

        const newSection = buildSection(header, entries, sectionMap, repoUrl);
        const updated = spliceSection(changelog, version, newSection);
        if (updated === changelog) {
            console.log('[enrich] CHANGELOG already current — nothing to do');
            return;
        }

        gh([
            'api',
            '-X',
            'PUT',
            `repos/${repo}/contents/packages/csszyx/CHANGELOG.md`,
            '-f',
            `message=docs: enrich ${version} release notes from squash commits`,
            '-f',
            `content=${Buffer.from(updated).toString('base64')}`,
            '-f',
            `sha=${changelogMeta.sha}`,
            '-f',
            `branch=${branch}`,
        ]);
        console.log(`[enrich] CHANGELOG ${version} enriched`);

        // Mirror into the release PR body so reviewers see the rich notes too.
        const prs = JSON.parse(
            gh(['api', `repos/${repo}/pulls?head=${repo.split('/')[0]}:${branch}&state=open`]),
        );
        const pr = prs[0];
        if (pr) {
            const body = `:robot: I have created a release *beep* *boop*\n---\n\n\n<details><summary>${version}</summary>\n\n${newSection}\n</details>\n\n---\nThis PR was generated with [Release Please](https://github.com/googleapis/release-please).`;
            gh(['api', '-X', 'PATCH', `repos/${repo}/pulls/${pr.number}`, '-f', `body=${body}`]);
            console.log(`[enrich] PR #${pr.number} body updated`);
        }
    } catch (err) {
        // Best-effort: never fail the release job.
        console.log(`[enrich] skipped (${err?.message || err})`);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
