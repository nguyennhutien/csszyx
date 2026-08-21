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
 * Whether the registry is telling us it already holds this exact version.
 *
 * npm answers a re-send of a version it has with a conflict, and the wording
 * separates two very different situations. "Failed to save packument" is a lost
 * write race and worth sending again. "Cannot publish over" means the version
 * is there: sending it again can only conflict a second time, so the thing to
 * wait for is the registry exposing it, not another upload.
 *
 * @param {string} output - Combined publish stdout and stderr.
 * @returns {boolean}
 */
export function registryAcceptedVersion(output) {
    return /Cannot publish over previously staged version|cannot publish over the previously published versions/i.test(
        output,
    );
}

/**
 * Whether a publish authenticated through OIDC rather than the long-lived token.
 *
 * pnpm attempts trusted publishing first and falls back to `NODE_AUTH_TOKEN`
 * when npm has no trusted publisher for the package, printing a warning as it
 * does. The fallback is silent in every other respect: the publish succeeds
 * either way, so a repo mid-migration cannot tell from the outcome whether OIDC
 * is actually carrying the release. Absence of a warning is exactly the kind of
 * signal that rots unnoticed, so the caller asserts on this instead.
 *
 * @param {string} output - Combined publish stdout and stderr.
 * @returns {boolean} True when no OIDC fallback warning was printed.
 */
export function usedOidcAuth(output) {
    return !/Skipped OIDC|ERR_PNPM_AUTH_TOKEN_EXCHANGE/i.test(output);
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
        requireOidc = false,
    } = options;
    const published = [];
    const skipped = [];
    const tokenFallbacks = [];

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
            const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
            const visible = await waitForPublished(
                pkg,
                isPublished,
                sleep,
                visibilityDelaysMs,
            );

            // Visible is the happy answer, but not the only one that means the
            // upload worked. A publish that exited clean, or one the registry
            // refused because it already holds this version, is on the registry
            // whether or not it has propagated yet — and sending it again can
            // only conflict with the copy that is already there, burning the
            // remaining attempts and abandoning every package queued behind
            // this one. What is still owed is the version appearing, and the
            // final audit below is what waits for that.
            const accepted =
                visible || result.code === 0 || registryAcceptedVersion(output);
            if (accepted) {
                const viaOidc = usedOidcAuth(output);
                if (!viaOidc) {
                    tokenFallbacks.push(spec);
                }
                const auth = viaOidc ? 'oidc' : 'token';
                log(
                    visible
                        ? `OK ${spec} is visible on npm (auth: ${auth})`
                        : `OK ${spec} accepted by npm, not visible yet (auth: ${auth})`,
                );
                published.push(spec);
                completed = true;
                break;
            }

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

    // Report the auth path every release, so the token-to-OIDC migration has a
    // positive signal rather than the absence of a warning. Once every package
    // has a trusted publisher on npm, set requireOidc to turn a silent fallback
    // into a failed release — the gate to flip before NODE_AUTH_TOKEN is
    // removed, and before the ~Jan 2027 deadline removes it for us.
    if (tokenFallbacks.length > 0) {
        const summary =
            `${tokenFallbacks.length}/${published.length} package(s) published through ` +
            `NODE_AUTH_TOKEN because npm had no trusted publisher for them:\n- ` +
            tokenFallbacks.join('\n- ');
        if (requireOidc) {
            throw new Error(`OIDC required but not used.\n${summary}`);
        }
        error(`[auth] ${summary}`);
    } else if (published.length > 0) {
        log(`[auth] all ${published.length} package(s) published through OIDC`);
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
            ['publish', '--access', 'public', '--no-git-checks', '--provenance'],
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
        // Opt-in until every package has a trusted publisher configured on
        // npm; flipping it is the last step of the token-to-OIDC migration.
        requireOidc: process.env.CSSZYX_REQUIRE_OIDC === '1',
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
