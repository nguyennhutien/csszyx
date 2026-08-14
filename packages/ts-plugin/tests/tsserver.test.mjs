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
            // Spawns a real tsserver and waits on its protocol responses, so the
            // budget has to cover process startup under load, not just the
            // request. Measured at ~1.2s alone; a full parallel run pushed it
            // past the old 8s and failed as a timeout, which reads as a broken
            // plugin rather than a busy machine.
            const timer = setTimeout(
                () => reject(new Error(`${label} tsserver response ${seq} timed out`)),
                30_000,
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
        // Ask until the answer holds what is being asserted, rather than
        // sleeping a fixed time and hoping. tsserver accepts requests before
        // its plugins are in place, so a fixed wait is a guess about the
        // machine: 800 ms was enough here and not on a loaded CI runner. The
        // first version of this loop then stopped at the first owned entry,
        // which is a second guess of the same kind — a partial list is still
        // an answer, and CI produced one carrying `bg` but not `hover`.
        //
        // Waiting for the keys the assertions name is not circular: a plugin
        // that never supplies them runs out the deadline and fails on those
        // same assertions, one deadline later instead of at the first poll.
        const deadline = Date.now() + 30_000;
        let response;
        let owned = [];
        let names = new Set();
        while (true) {
            response = await responseFor(
                send('completionInfo', {
                    file: fileName,
                    line: 1,
                    offset: completionOffset,
                }),
            );
            const entries = response.body?.entries ?? [];
            owned = entries.filter(
                entry =>
                    entry.data?.owner === '@csszyx/ts-plugin' && entry.data?.schema === 1,
            );
            names = new Set(entries.map(entry => entry.name));
            const ready =
                owned.some(entry => entry.name === 'bg') &&
                names.has('bg') &&
                names.has('hover');
            if (ready || Date.now() >= deadline) break;
            await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
        }
        return { response, owned, names };
    } finally {
        child.kill();
    }
};

for (const [label, serverPath] of servers) {
    test(`${label} tsserver loads the csszyx plugin`, async () => {
        const { response, owned, names } = await runServer(label, serverPath);
        assert.strictEqual(response.success, true);
        // Counted in the message: a failure here is either "the plugin never
        // answered" or "it answered with part of its keys", and the numbers
        // say which without another run.
        const seen = `${owned.length} owned of ${names.size} entries`;
        assert.ok(owned.some(entry => entry.name === 'bg'), `plugin never owned "bg" — ${seen}`);
        // The base service may own a key once project typing finishes, and the
        // plugin deliberately dedupes that entry. Assert the merged protocol
        // result instead of requiring duplicate ownership from the plugin.
        assert.ok(names.has('bg'), `merged result lacks "bg" — ${seen}`);
        assert.ok(names.has('hover'), `merged result lacks "hover" — ${seen}`);
        console.log(`${label} tsserver check passed (${owned.length} csszyx entries)`);
    });
}
