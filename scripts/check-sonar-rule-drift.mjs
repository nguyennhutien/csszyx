#!/usr/bin/env node
// What Sonar checks on a pull request that nothing here checks before the push.
//
// Chasing Sonar findings one rule at a time is how two releases in a row ended
// with a green local run and a red quality gate. The rules themselves are not
// the problem; not knowing WHICH rules only exist on the server is. This asks
// the server directly and prints the difference.
//
// The mapping is exact where it exists: `eslint-plugin-sonarjs` is Sonar's own
// implementation and every rule carries its RSPEC id in `meta.docs.url`, so an
// active `typescript:S3776` lines up with `sonarjs/cognitive-complexity` with
// no table to maintain.
//
// READ THE SECOND BUCKET CAREFULLY. "A local rule exists and is off" does not
// mean the check is missing: biome, typescript-eslint and unicorn cover a lot
// of the same ground under different names, and this script cannot map those —
// they publish no RSPEC id. The bucket is a list of candidates to look at, not
// a list of rules to switch on, and switching one on can light up code nobody
// intended to touch. Each one is its own decision: enable it, record here that
// something else already covers it, or deactivate it on the Sonar profile
// because it does not apply to this repository.
//
// Not wired into CI on purpose. A gate that calls an external API fails when
// the API is slow, and a report nobody can reproduce offline is worse than one
// run by hand when the quality profile changes.
//
// Usage: node scripts/check-sonar-rule-drift.mjs [--json] [--language=<lang>]

import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The organisation and project this repository reports to. */
const SONAR_HOST = 'https://sonarcloud.io';

/**
 * Rules a dedicated gate enforces rather than the shared eslint config.
 *
 * These do not appear in `calculateConfigForFile`, because the gate passes them
 * on the command line for the files it has decided to check. Without this list
 * the report would name a rule that is already enforced as something to
 * consider enabling, which is the fastest way to make a report ignored.
 */
const GATED_RULES = new Map([
    ['sonarjs/cognitive-complexity', 'scripts/check-changed-complexity.mjs'],
]);

/**
 * Read `sonar-project.properties` into a plain map.
 *
 * @param file - Path to the properties file.
 * @returns Key to value, comments and blank lines dropped.
 */
export function readSonarProperties(file) {
    const entries = readFileSync(file, 'utf8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line !== '' && !line.startsWith('#'))
        .map(line => {
            const split = line.indexOf('=');
            return split === -1
                ? null
                : [line.slice(0, split).trim(), line.slice(split + 1).trim()];
        })
        .filter(entry => entry !== null);
    return Object.fromEntries(entries);
}

/**
 * The RSPEC identifier a sonarjs rule documents itself with.
 *
 * @param url - The `meta.docs.url` of an eslint rule.
 * @returns The identifier, or null when the url is not an RSPEC link.
 */
export function rspecId(url) {
    const match = /rspec\/(S\d+)\//.exec(url ?? '');
    return match === null ? null : match[1];
}

/**
 * Whether an eslint rule setting turns the rule on.
 *
 * @param setting - A severity, or an array whose first element is one.
 * @returns True when the rule would report.
 */
export function isEnabled(setting) {
    const severity = Array.isArray(setting) ? setting[0] : setting;
    return severity !== 0 && severity !== 'off';
}

/**
 * Sort Sonar's active rules into what is covered here and what is not.
 *
 * @param sonarRules - Active rules, each with a `key` like `typescript:S3776`.
 * @param localByRspec - RSPEC id mapped to the local rule name implementing it.
 * @param enabled - Names of the local rules that are switched on.
 * @returns The three buckets, each sorted by rule key.
 */
export function bucketRules(sonarRules, localByRspec, enabled) {
    const covered = [];
    const availableOff = [];
    const noLocal = [];
    for (const rule of sonarRules) {
        const id = rule.key.split(':')[1];
        const local = localByRspec.get(id);
        if (local === undefined) noLocal.push({ ...rule, local: null });
        else if (enabled.has(`sonarjs/${local}`)) covered.push({ ...rule, local });
        else availableOff.push({ ...rule, local });
    }
    const byKey = (left, right) => left.key.localeCompare(right.key);
    return {
        covered: covered.sort(byKey),
        availableOff: availableOff.sort(byKey),
        noLocal: noLocal.sort(byKey),
    };
}

/**
 * Every rule the project's quality profile has switched on for one language.
 *
 * Read without a token: the project is public, and SonarCloud answers profile
 * and rule queries anonymously for those. A private project would need one.
 *
 * @param organization - Sonar organisation key.
 * @param project - Sonar project key.
 * @param language - Sonar language key, `ts` for TypeScript.
 * @returns The active rules.
 */
async function activeRules(organization, project, language) {
    const profiles = await fetch(
        `${SONAR_HOST}/api/qualityprofiles/search?organization=${organization}&project=${project}`,
    ).then(response => response.json());
    const profile = (profiles.profiles ?? []).find(entry => entry.language === language);
    if (profile === undefined) {
        throw new Error(`no quality profile for language '${language}' on ${project}`);
    }
    const rules = await fetch(
        `${SONAR_HOST}/api/rules/search?organization=${organization}` +
            `&activation=true&qprofile=${profile.key}&ps=500&f=name`,
    ).then(response => response.json());
    return { profile, rules: rules.rules ?? [], total: rules.total ?? 0 };
}

/**
 * The RSPEC ids `eslint-plugin-sonarjs` implements, mapped to its rule names.
 *
 * @returns RSPEC id to rule name.
 */
async function localSonarRules() {
    const { default: plugin } = await import('eslint-plugin-sonarjs');
    const byRspec = new Map();
    for (const [name, rule] of Object.entries(plugin.rules ?? {})) {
        const id = rspecId(rule.meta?.docs?.url);
        if (id !== null) byRspec.set(id, name);
    }
    return byRspec;
}

/**
 * The eslint rules switched on for a file representative of package source.
 *
 * Asked per file because the config is per path: the `sonarjs` block covers
 * `packages/**` and nothing else, so asking about a script would answer for a
 * different rule set entirely.
 *
 * @param file - Repo-relative path to ask about.
 * @returns Rule names that are on.
 */
async function enabledLocalRules(file) {
    const { ESLint } = await import('eslint');
    const config = await new ESLint().calculateConfigForFile(file);
    return new Set([
        ...Object.entries(config.rules ?? {})
            .filter(([, setting]) => isEnabled(setting))
            .map(([name]) => name),
        ...GATED_RULES.keys(),
    ]);
}

/**
 * Print the drift, or emit it as JSON.
 *
 * @param options - Language to ask about and output format.
 * @param options.language - Sonar language key.
 * @param options.json - Whether to print machine-readable output.
 * @returns Process exit code.
 */
async function main({ language, json }) {
    const properties = readSonarProperties('sonar-project.properties');
    const organization = properties['sonar.organization'];
    const project = properties['sonar.projectKey'];
    const [{ profile, rules, total }, localByRspec, enabled] = await Promise.all([
        activeRules(organization, project, language),
        localSonarRules(),
        enabledLocalRules('packages/unplugin/src/unplugin.ts'),
    ]);
    const buckets = bucketRules(rules, localByRspec, enabled);

    if (json) {
        console.log(JSON.stringify({ profile: profile.name, total, ...buckets }, null, 2));
        return 0;
    }

    console.log(`Sonar profile '${profile.name}' (${language}) has ${total} rules active.`);
    console.log(`  ${buckets.covered.length} covered by a local rule that is on`);
    for (const rule of buckets.covered) {
        const gate = GATED_RULES.get(`sonarjs/${rule.local}`);
        console.log(
            `      ${rule.key} sonarjs/${rule.local}${gate === undefined ? '' : ` (via ${gate})`}`,
        );
    }
    console.log(`  ${buckets.availableOff.length} have a local rule that is off — candidates`);
    console.log(`  ${buckets.noLocal.length} have no local implementation at all\n`);
    console.log('Candidates (a local rule exists and is not on):');
    for (const rule of buckets.availableOff) {
        console.log(`  ${rule.key.padEnd(20)} sonarjs/${rule.local.padEnd(34)} ${rule.name}`);
    }
    console.log(
        '\nBefore switching any of these on, check whether biome or typescript-eslint\n' +
            'already covers it under another name — this script cannot see that, because\n' +
            'those rules publish no RSPEC id.',
    );
    return 0;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    const args = process.argv.slice(2);
    const languageFlag = args.find(argument => argument.startsWith('--language='));
    main({
        language: languageFlag === undefined ? 'ts' : languageFlag.slice('--language='.length),
        json: args.includes('--json'),
    })
        .then(code => process.exit(code))
        .catch(error => {
            console.error(`[sonar-drift] ${error.message}`);
            process.exit(1);
        });
}
