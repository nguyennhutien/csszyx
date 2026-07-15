import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRequire = createRequire(import.meta.url);
const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageDirectory, '../..');
const rootRequire = createRequire(join(repositoryRoot, 'package.json'));
const projectRoot = join(repositoryRoot, 'playground/vite-react');
const fileName = join(projectRoot, 'src/App.tsx');
// A szv innermost variant object: SzObject's index signature means TypeScript
// itself offers no key completions there, so every sz key the plugin returns is
// unambiguously its own. (A plain `sz={{}}` prop is a weaker probe: when the
// project's sz JSX type resolves, the base service already lists keys like `bg`
// and the plugin correctly dedupes them, so they would not appear as owned.)
const source = "import { szv } from 'csszyx'; const s = szv({ variants: { size: { sm: {  } } } });";
const completionOffset = source.indexOf('{  }') + 3;
const servers = new Map([
    ['lowest', packageRequire.resolve('typescript/lib/tsserver.js')],
    ['current', rootRequire.resolve('typescript/lib/tsserver.js')],
]);

const runServer = async (label, serverPath) => {
    const child = spawn(process.execPath, [serverPath, '--allowLocalPluginLoads'], {
        cwd: projectRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buffer = Buffer.alloc(0);
    let sequence = 0;
    const responses = new Map();
    const send = (command, args) => {
        const seq = ++sequence;
        child.stdin.write(`${JSON.stringify({ seq, type: 'request', command, arguments: args })}\n`);
        return seq;
    };
    const responseFor = seq =>
        new Promise((resolveResponse, reject) => {
            const timer = setTimeout(
                () => reject(new Error(`${label} tsserver response ${seq} timed out`)),
                8_000,
            );
            responses.set(seq, message => {
                clearTimeout(timer);
                resolveResponse(message);
            });
        });
    child.stdout.on('data', chunk => {
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
    try {
        send('open', { file: fileName, fileContent: source, projectRootPath: projectRoot });
        await new Promise(resolveDelay => setTimeout(resolveDelay, 800));
        const request = send('completionInfo', {
            file: fileName,
            line: 1,
            offset: completionOffset,
        });
        const response = await responseFor(request);
        const owned = (response.body?.entries ?? []).filter(
            entry =>
                entry.data?.owner === '@csszyx/ts-plugin' && entry.data?.schema === 1,
        );
        return { response, owned };
    } finally {
        child.kill();
    }
};

for (const [label, serverPath] of servers) {
    test(`${label} tsserver loads the csszyx plugin`, async () => {
        const { response, owned } = await runServer(label, serverPath);
        assert.strictEqual(response.success, true);
        assert.ok(owned.some(entry => entry.name === 'bg'));
        assert.ok(owned.some(entry => entry.name === 'hover'));
        console.log(`${label} tsserver check passed (${owned.length} csszyx entries)`);
    });
}
