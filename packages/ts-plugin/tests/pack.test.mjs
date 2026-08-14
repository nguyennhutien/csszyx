import assert from 'node:assert';
import { execFileSync, spawn } from 'node:child_process';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageDirectory, '../..');
const fixture = mkdtempSync(join(tmpdir(), 'csszyx-ts-plugin-pack-'));
const tarballs = join(fixture, 'tarballs');
const install = join(fixture, 'consumer');
const cache = join(fixture, 'npm-cache');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const version = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8')).version;
const typescriptPackage = resolve(packageDirectory, 'node_modules/typescript');

test('packed plugin remains self-contained and loads in tsserver', async () => {
// tooling-metadata is the bundle INPUT (a private workspace package); build it,
// then build the plugin so esbuild inlines its data into dist/index.js.
execFileSync(pnpm, ['--filter', '@csszyx/tooling-metadata', 'build'], {
    cwd: repositoryRoot,
    stdio: 'pipe',
});
execFileSync(pnpm, ['--filter', '@csszyx/ts-plugin', 'build'], {
    cwd: repositoryRoot,
    stdio: 'pipe',
});
// Pack ONLY the plugin — a self-contained consumer never installs the metadata.
execFileSync(pnpm, ['--filter', '@csszyx/ts-plugin', 'pack', '--pack-destination', tarballs], {
    cwd: repositoryRoot,
    stdio: 'pipe',
});

const pluginTarball = join(tarballs, `csszyx-ts-plugin-${version}.tgz`);
assert.ok(statSync(pluginTarball).size < 64 * 1024, 'the packed plugin must stay small');
execFileSync(
    npm,
    [
        'install',
        '--cache',
        cache,
        '--prefix',
        install,
        '--ignore-scripts',
        typescriptPackage,
        pluginTarball,
    ],
    { cwd: repositoryRoot, stdio: 'pipe' },
);

const fixtureRequire = createRequire(join(install, 'package.json'));
assert.strictEqual(typeof fixtureRequire('@csszyx/ts-plugin'), 'function');
const packedManifest = JSON.parse(
    readFileSync(join(install, 'node_modules/@csszyx/ts-plugin/package.json'), 'utf8'),
);
// The bundle inlines all data, so the shipped package declares no runtime deps —
// in particular not the now-private @csszyx/tooling-metadata, nor typescript.
assert.ok(
    !packedManifest.dependencies || Object.keys(packedManifest.dependencies).length === 0,
    'the self-contained plugin must declare no runtime dependencies',
);
// The metadata is not installed as a package; it survives only as inlined data.
assert.throws(
    () => fixtureRequire('@csszyx/tooling-metadata'),
    'tooling-metadata must not be a resolvable dependency of the consumer',
);

const sourceDirectory = join(install, 'src');
const sourceFile = join(sourceDirectory, 'probe.tsx');
const themeDirectory = join(install, '.csszyx');
const themeFile = join(themeDirectory, 'theme.d.ts');
const renamedThemeFile = join(themeDirectory, 'renamed-theme.d.ts');
const source = 'const Probe = () => <div sz={{ bg:  }} />;';
mkdirSync(sourceDirectory, { recursive: true });
mkdirSync(themeDirectory, { recursive: true });
writeFileSync(
    join(install, 'tsconfig.json'),
    JSON.stringify({
        compilerOptions: {
            jsx: 'react-jsx',
            plugins: [{ name: '@csszyx/ts-plugin', themeValues: true }],
        },
        include: ['src', '.csszyx/*.d.ts'],
    }),
);
writeFileSync(sourceFile, source);

const server = spawn(
    process.execPath,
    [fixtureRequire.resolve('typescript/lib/tsserver.js'), '--allowLocalPluginLoads'],
    { cwd: install, stdio: ['pipe', 'pipe', 'pipe'] },
);
let buffer = Buffer.alloc(0);
let sequence = 0;
const responses = new Map();
server.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const header = buffer.subarray(0, headerEnd).toString();
        const length = Number(/Content-Length: (\d+)/i.exec(header)?.[1]);
        if (!Number.isFinite(length) || buffer.length < headerEnd + 4 + length) return;
        const message = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length));
        buffer = buffer.subarray(headerEnd + 4 + length);
        if (message.type === 'response') responses.get(message.request_seq)?.(message);
    }
});

const send = (command, args, expectResponse = true) => {
    const seq = ++sequence;
    const response = expectResponse
        ? new Promise((resolveResponse, reject) => {
              const timer = setTimeout(
                  () => reject(new Error(`packed tsserver ${command} timed out`)),
                  30_000,
              );
              responses.set(seq, message => {
                  clearTimeout(timer);
                  responses.delete(seq);
                  resolveResponse(message);
              });
          })
        : undefined;
    server.stdin.write(`${JSON.stringify({ seq, type: 'request', command, arguments: args })}\n`);
    return response;
};

send(
    'open',
    {
        file: sourceFile,
        projectRootPath: install,
        fileContent: source,
    },
    false,
);

const completionNames = async () => {
    const response = await send('completionInfo', {
        file: sourceFile,
        line: 1,
        offset: source.indexOf('bg:') + 'bg: '.length + 1,
    });
    assert.strictEqual(response.success, true);
    return new Set((response.body?.entries ?? []).map(entry => entry.name));
};
const waitForNames = async (predicate, label) => {
    const deadline = Date.now() + 30_000;
    let names = new Set();
    while (Date.now() < deadline) {
        names = await completionNames();
        if (predicate(names)) return names;
        await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
    }
    assert.fail(`${label}; saw ${[...names].slice(-10).join(', ')}`);
};
const theme = token => `
declare module '@csszyx/compiler' {
    interface CustomTheme { colors: '${token}'; }
}
export {};
`;

try {
    await waitForNames(names => names.has('red-500') && !names.has('brand'), 'base values load');

    writeFileSync(themeFile, theme('brand'));
    await send('reloadProjects', {});
    await waitForNames(names => names.has('brand'), 'added theme declaration refreshes');

    writeFileSync(themeFile, theme('accent'));
    await send('reloadProjects', {});
    await waitForNames(
        names => names.has('accent') && !names.has('brand'),
        'edited theme declaration refreshes',
    );

    renameSync(themeFile, renamedThemeFile);
    await send('reloadProjects', {});
    await waitForNames(names => !names.has('accent'), 'renamed declaration is removed');

    renameSync(renamedThemeFile, themeFile);
    await send('reloadProjects', {});
    await waitForNames(names => names.has('accent'), 'canonical rename restores declaration');

    rmSync(themeFile);
    await send('reloadProjects', {});
    await waitForNames(names => !names.has('accent'), 'deleted declaration is removed');

    const completionResponse = await send('completionInfo', {
        file: sourceFile,
        line: 1,
        offset: source.indexOf('bg:') + 'bg: '.length + 1,
    });
    const owned = (completionResponse.body?.entries ?? []).filter(
        entry => entry.data?.owner === '@csszyx/ts-plugin' && entry.data?.schema === 1,
    );
    // Inlined data survives the pack/install round-trip with zero external deps.
    assert.ok(owned.some(entry => entry.name === 'red-500'));
} finally {
    server.kill();
}

console.log('packed self-contained plugin (inlined metadata, no runtime deps) check passed');
});
