import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import {
    isRetryablePublishFailure,
    publishPackageSet,
    usedOidcAuth,
    registryHasVersion,
    sortPackagesByWorkspaceDependencies,
} from './publish-workspace.mjs';

function pkg(name, dependencies = []) {
    return {
        name,
        version: '1.2.3',
        path: `/repo/${name}`,
        workspaceDependencies: new Set(dependencies),
    };
}

test('sorts workspace dependencies before dependants', () => {
    const packages = [
        pkg('umbrella', ['compiler', 'runtime']),
        pkg('runtime', ['compiler']),
        pkg('compiler', ['core']),
        pkg('core', ['native']),
        pkg('native'),
    ];

    assert.deepEqual(
        sortPackagesByWorkspaceDependencies(packages).map((item) => item.name),
        ['native', 'core', 'compiler', 'runtime', 'umbrella'],
    );
});

test('rejects workspace dependency cycles', () => {
    assert.throws(
        () =>
            sortPackagesByWorkspaceDependencies([
                pkg('a', ['b']),
                pkg('b', ['a']),
            ]),
        /Workspace dependency cycle: a -> b -> a/,
    );
});

test('skips immutable versions that already exist', async () => {
    let publishCalls = 0;
    const result = await publishPackageSet([pkg('core')], {
        isPublished: async () => true,
        runPublish: async () => {
            publishCalls++;
            return { code: 0, stdout: '', stderr: '' };
        },
        sleep: async () => {},
        log: () => {},
    });

    assert.equal(publishCalls, 0);
    assert.deepEqual(result, { published: [], skipped: ['core@1.2.3'] });
});

test('retries E409 and succeeds once the registry exposes the version', async () => {
    let published = false;
    let publishCalls = 0;
    const result = await publishPackageSet([pkg('adapter')], {
        isPublished: async () => published,
        runPublish: async () => {
            publishCalls++;
            if (publishCalls === 1) {
                return {
                    code: 1,
                    stdout: '',
                    stderr: 'npm error E409 Conflict - Failed to save packument',
                };
            }
            published = true;
            return { code: 0, stdout: 'published', stderr: '' };
        },
        sleep: async () => {},
        log: () => {},
        error: () => {},
        visibilityDelaysMs: [0],
    });

    assert.equal(publishCalls, 2);
    assert.deepEqual(result, { published: ['adapter@1.2.3'], skipped: [] });
});

test('waits for registry visibility after a successful publish', async () => {
    let checks = 0;
    let publishCalls = 0;
    const result = await publishPackageSet([pkg('types')], {
        isPublished: async () => {
            checks++;
            return checks >= 3;
        },
        runPublish: async () => {
            publishCalls++;
            return { code: 0, stdout: 'published', stderr: '' };
        },
        sleep: async () => {},
        log: () => {},
        visibilityDelaysMs: [0, 1],
    });

    assert.equal(publishCalls, 1);
    assert.deepEqual(result, { published: ['types@1.2.3'], skipped: [] });
});

test('does not retry permanent authentication or permission failures', async () => {
    let publishCalls = 0;
    await assert.rejects(
        publishPackageSet([pkg('adapter')], {
            isPublished: async () => false,
            runPublish: async () => {
                publishCalls++;
                return {
                    code: 1,
                    stdout: '',
                    stderr: 'npm error E403 Forbidden',
                };
            },
            sleep: async () => {},
            log: () => {},
            visibilityDelaysMs: [0],
        }),
        /Permanent publish failure for adapter@1.2.3/,
    );
    assert.equal(publishCalls, 1);
});

test('fails the final audit if a previously visible version disappears', async () => {
    let checks = 0;
    await assert.rejects(
        publishPackageSet([pkg('core')], {
            isPublished: async () => checks++ === 0,
            runPublish: async () => {
                throw new Error('publish must not run');
            },
            sleep: async () => {},
            log: () => {},
        }),
        /Final npm audit found missing packages:\n- core@1.2.3/,
    );
});

test('classifies only registry and network failures as retryable', () => {
    assert.equal(
        isRetryablePublishFailure('E409 Failed to save packument'),
        true,
    );
    assert.equal(isRetryablePublishFailure('npm ERR! code E429'), true);
    assert.equal(
        isRetryablePublishFailure('request failed with HTTP 503'),
        true,
    );
    assert.equal(isRetryablePublishFailure('read ECONNRESET'), true);
    assert.equal(isRetryablePublishFailure('npm ERR! code E403'), false);
    assert.equal(
        isRetryablePublishFailure('npm ERR! code E404 Not Found'),
        false,
    );
});

test('queries an exact scoped package version from the registry', async (context) => {
    const requests = [];
    const server = createServer((request, response) => {
        requests.push(request.url);
        response.writeHead(
            request.url.startsWith('/%40csszyx%2Fcore/1.2.3') ? 200 : 404,
        );
        response.end('{}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    context.after(() => server.close());
    const address = server.address();
    const registry = `http://127.0.0.1:${address.port}`;

    assert.equal(await registryHasVersion(pkg('@csszyx/core'), registry), true);
    assert.equal(
        await registryHasVersion(pkg('@csszyx/missing'), registry),
        false,
    );
    assert.equal(requests.length, 2);
});

test('surfaces non-404 registry responses for retry classification', async (context) => {
    const server = createServer((_request, response) => {
        response.writeHead(503);
        response.end('{}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    context.after(() => server.close());
    const address = server.address();

    await assert.rejects(
        registryHasVersion(pkg('core'), `http://127.0.0.1:${address.port}`),
        /npm registry query failed for core@1.2.3: HTTP 503/,
    );
});

const OIDC_FALLBACK_WARNING =
    '[WARN] Skipped OIDC: ERR_PNPM_AUTH_TOKEN_EXCHANGE: Failed token exchange request ' +
    'with body message: Unknown error (status code 404)';

test('reads the auth path off the publish output', () => {
    assert.equal(usedOidcAuth('+ csszyx@1.2.3'), true);
    assert.equal(usedOidcAuth(OIDC_FALLBACK_WARNING), false);
    // pnpm may word the warning either way; both mean the token carried it.
    assert.equal(usedOidcAuth('ERR_PNPM_AUTH_TOKEN_EXCHANGE'), false);
});

test('reports which auth path each package used', async () => {
    const lines = [];
    let published = false;
    await publishPackageSet([pkg('core')], {
        isPublished: async () => published,
        runPublish: async () => {
            published = true;
            return { code: 0, stdout: '', stderr: OIDC_FALLBACK_WARNING };
        },
        sleep: async () => {},
        log: (line) => lines.push(line),
        error: (line) => lines.push(line),
    });

    assert.ok(
        lines.some((line) => line.includes('auth: token')),
        lines.join('\n'),
    );
    assert.ok(
        lines.some((line) => line.includes('[auth]') && line.includes('trusted publisher')),
        lines.join('\n'),
    );
});

test('fails the release when OIDC is required but the token carried it', async () => {
    let published = false;
    await assert.rejects(
        publishPackageSet([pkg('core')], {
            isPublished: async () => published,
            runPublish: async () => {
                published = true;
                return { code: 0, stdout: '', stderr: OIDC_FALLBACK_WARNING };
            },
            sleep: async () => {},
            log: () => {},
            error: () => {},
            requireOidc: true,
        }),
        /OIDC required but not used/,
    );
});

test('stays silent about auth when every package used OIDC', async () => {
    let published = false;
    const lines = [];
    await publishPackageSet([pkg('core')], {
        isPublished: async () => published,
        runPublish: async () => {
            published = true;
            return { code: 0, stdout: '+ core@1.2.3', stderr: '' };
        },
        sleep: async () => {},
        log: (line) => lines.push(line),
        error: (line) => lines.push(line),
        requireOidc: true,
    });

    assert.ok(lines.some((line) => line.includes('auth: oidc')), lines.join('\n'));
    assert.ok(lines.some((line) => line.includes('all 1 package(s) published through OIDC')));
});
