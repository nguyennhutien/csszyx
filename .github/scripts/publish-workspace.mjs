#!/usr/bin/env node

import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_PUBLISH_ATTEMPTS = 5;
const VISIBILITY_DELAYS_MS = [0, 2_000, 3_000, 5_000, 8_000, 13_000];

/**
 * Return public workspace packages in dependency order.
 *
 * @param {string} rootDir - Workspace root.
 * @returns {Array<WorkspacePackage>}
 */
export function discoverPublishablePackages(rootDir) {
    const output = execFileSync(
        'pnpm',
        ['list', '--recursive', '--depth', '-1', '--json'],
        {
            cwd: rootDir,
            encoding: 'utf8',
        },
    );
    const workspaces = JSON.parse(output);
    const packages = workspaces
        .filter(
            (workspace) =>
                workspace.private !== true && workspace.path !== rootDir,
        )
        .map((workspace) => {
            const manifest = JSON.parse(
                readFileSync(`${workspace.path}/package.json`, 'utf8'),
            );
            return {
                name: manifest.name,
                version: manifest.version,
                path: workspace.path,
                workspaceDependencies: collectWorkspaceDependencies(manifest),
            };
        });

    return sortPackagesByWorkspaceDependencies(packages);
}

/**
 * Sort packages so workspace dependencies are published before dependants.
 *
 * @param {Array<WorkspacePackage>} packages - Public workspace packages.
 * @returns {Array<WorkspacePackage>}
 */
export function sortPackagesByWorkspaceDependencies(packages) {
    const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
    const visiting = new Set();
    const visited = new Set();
    const sorted = [];

    function visit(pkg, ancestry) {
        if (visited.has(pkg.name)) {
            return;
        }
        if (visiting.has(pkg.name)) {
            throw new Error(
                `Workspace dependency cycle: ${[...ancestry, pkg.name].join(' -> ')}`,
            );
        }

        visiting.add(pkg.name);
        const dependencies = [...pkg.workspaceDependencies]
            .filter((name) => byName.has(name))
            .sort();
        for (const dependency of dependencies) {
            visit(byName.get(dependency), [...ancestry, pkg.name]);
        }
        visiting.delete(pkg.name);
        visited.add(pkg.name);
        sorted.push(pkg);
    }

    for (const pkg of [...packages].sort((left, right) =>
        left.name.localeCompare(right.name),
    )) {
        visit(pkg, []);
    }
    return sorted;
}

/**
 * Identify failures that can resolve without changing repository or npm access.
 *
 * @param {string} output - Combined publish stdout and stderr.
 * @returns {boolean}
 */
export function isRetryablePublishFailure(output) {
    return /(?:E409|409 Conflict|Failed to save packument|E429|429 Too Many Requests|E5\d\d|HTTP\s+5\d\d|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|socket hang up)/i.test(
        output,
    );
}

/**
 * Publish all public packages while safely resuming a partial release.
 *
 * @param {Array<WorkspacePackage>} packages - Dependency-ordered packages.
 * @param {PublishOptions} options - Registry and process adapters.
 * @returns {Promise<{published: string[], skipped: string[]}>}
 */
export async function publishPackageSet(packages, options) {
    const {
        isPublished,
        runPublish,
        sleep = defaultSleep,
        log = console.log,
        error = console.error,
        publishAttempts = DEFAULT_PUBLISH_ATTEMPTS,
        visibilityDelaysMs = VISIBILITY_DELAYS_MS,
    } = options;
    const published = [];
    const skipped = [];

    for (const pkg of packages) {
        const spec = `${pkg.name}@${pkg.version}`;
        if (await queryWithRetry(() => isPublished(pkg), sleep)) {
            log(`SKIP ${spec} already exists`);
            skipped.push(spec);
            continue;
        }

        let completed = false;
        for (let attempt = 1; attempt <= publishAttempts; attempt++) {
            log(`PUBLISH ${spec} (attempt ${attempt}/${publishAttempts})`);
            const result = await runPublish(pkg);
            const visible = await waitForPublished(
                pkg,
                isPublished,
                sleep,
                visibilityDelaysMs,
            );

            if (visible) {
                log(`OK ${spec} is visible on npm`);
                published.push(spec);
                completed = true;
                break;
            }

            const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
            if (result.code !== 0 && !isRetryablePublishFailure(output)) {
                throw new Error(
                    `Permanent publish failure for ${spec}:\n${output.trim()}`,
                );
            }
            if (attempt === publishAttempts) {
                throw new Error(
                    `npm did not expose ${spec} after ${publishAttempts} publish attempts.\n${output.trim()}`,
                );
            }

            const retryDelay = Math.min(5_000 * 2 ** (attempt - 1), 40_000);
            error(
                `Transient publish failure for ${spec}; retrying in ${retryDelay}ms.`,
            );
            await sleep(retryDelay);
        }

        if (!completed) {
            throw new Error(`Publish did not complete for ${spec}`);
        }
    }

    const missing = [];
    for (const pkg of packages) {
        if (!(await queryWithRetry(() => isPublished(pkg), sleep))) {
            missing.push(`${pkg.name}@${pkg.version}`);
        }
    }
    if (missing.length > 0) {
        throw new Error(
            `Final npm audit found missing packages:\n- ${missing.join('\n- ')}`,
        );
    }

    return { published, skipped };
}

/**
 * Query whether an exact immutable package version exists.
 *
 * @param {WorkspacePackage} pkg - Package identity.
 * @param {string} registry - npm registry base URL.
 * @returns {Promise<boolean>}
 */
export async function registryHasVersion(pkg, registry = DEFAULT_REGISTRY) {
    const base = registry.replace(/\/+$/, '');
    const url = `${base}/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}?cacheBust=${Date.now()}`;
    const response = await fetch(url, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
    });
    if (response.status === 200) {
        return true;
    }
    if (response.status === 404) {
        return false;
    }
    throw new Error(
        `npm registry query failed for ${pkg.name}@${pkg.version}: HTTP ${response.status}`,
    );
}

/**
 * Run pnpm publish for one package and retain output for failure classification.
 *
 * @param {WorkspacePackage} pkg - Package to publish.
 * @returns {Promise<PublishResult>}
 */
export function runPnpmPublish(pkg) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            'pnpm',
            ['publish', '--access', 'public', '--no-git-checks'],
            {
                cwd: pkg.path,
                env: process.env,
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            const text = chunk.toString();
            stdout += text;
            process.stdout.write(text);
        });
        child.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            stderr += text;
            process.stderr.write(text);
        });
        child.on('error', reject);
        child.on('close', (code) =>
            resolve({ code: code ?? 1, stdout, stderr }),
        );
    });
}

async function waitForPublished(pkg, isPublished, sleep, delays) {
    for (const delay of delays) {
        if (delay > 0) {
            await sleep(delay);
        }
        try {
            if (await isPublished(pkg)) {
                return true;
            }
        } catch (queryError) {
            if (!isRetryableRegistryQuery(queryError)) {
                throw queryError;
            }
        }
    }
    return false;
}

async function queryWithRetry(query, sleep) {
    const delays = [0, 1_000, 3_000];
    let lastError;
    for (const delay of delays) {
        if (delay > 0) {
            await sleep(delay);
        }
        try {
            return await query();
        } catch (queryError) {
            if (!isRetryableRegistryQuery(queryError)) {
                throw queryError;
            }
            lastError = queryError;
        }
    }
    throw lastError;
}

function isRetryableRegistryQuery(error) {
    return /HTTP (?:429|5\d\d)|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|fetch failed/i.test(
        String(error?.message ?? error),
    );
}

function collectWorkspaceDependencies(manifest) {
    const fields = [
        manifest.dependencies,
        manifest.optionalDependencies,
        manifest.peerDependencies,
    ];
    return new Set(
        fields.flatMap((dependencies) =>
            Object.entries(dependencies ?? {})
                .filter(([, range]) => String(range).startsWith('workspace:'))
                .map(([name]) => name),
        ),
    );
}

function defaultSleep(delay) {
    return new Promise((resolve) => setTimeout(resolve, delay));
}

async function main() {
    const rootDir = process.cwd();
    const registry = process.env.npm_config_registry || DEFAULT_REGISTRY;
    const packages = discoverPublishablePackages(rootDir);

    console.log(
        `Publishing ${packages.length} public workspace packages in dependency order.`,
    );
    const result = await publishPackageSet(packages, {
        isPublished: (pkg) => registryHasVersion(pkg, registry),
        runPublish: runPnpmPublish,
    });
    console.log(
        `npm publish complete: ${result.published.length} published, ${result.skipped.length} already present.`,
    );
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}

/**
 * @typedef {object} WorkspacePackage
 * @property {string} name
 * @property {string} version
 * @property {string} path
 * @property {Set<string>} workspaceDependencies
 */

/**
 * @typedef {object} PublishResult
 * @property {number} code
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * @typedef {object} PublishOptions
 * @property {(pkg: WorkspacePackage) => Promise<boolean>} isPublished
 * @property {(pkg: WorkspacePackage) => Promise<PublishResult>} runPublish
 * @property {(delay: number) => Promise<void>} [sleep]
 * @property {(message: string) => void} [log]
 * @property {(message: string) => void} [error]
 * @property {number} [publishAttempts]
 * @property {number[]} [visibilityDelaysMs]
 */
