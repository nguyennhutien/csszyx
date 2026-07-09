import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const init = require('../dist/index.js');

let programAttempts = 0;
let disposeCalls = 0;
let cancelled = false;
const logs = [];
const base = {
    isGlobalCompletion: false,
    isMemberCompletion: true,
    isNewIdentifierLocation: true,
    entries: [{ name: 'base', kind: 'var', kindModifiers: '', sortText: '1' }],
};
const service = {
    getCompletionsAtPosition: () => base,
    getCompletionEntryDetails: () => undefined,
    getProgram: () => {
        programAttempts += 1;
        throw new Error('synthetic failure\nwithout source content');
    },
    dispose: () => {
        disposeCalls += 1;
    },
};
const module = init({ typescript: ts });
const proxy = module.create({
    config: { failureThreshold: 2 },
    languageService: service,
    project: {
        projectService: {
            cancellationToken: { isCancellationRequested: () => cancelled },
            logger: { info: message => logs.push(message) },
        },
    },
});

const activationLogs = logs.filter(message => message.includes('activated'));
assert.strictEqual(activationLogs.length, 1, 'exactly one activation marker is logged');
const failureLogsBefore = () => logs.filter(message => !message.includes('activated'));

assert.strictEqual(proxy.getCompletionsAtPosition('/x.tsx', 0), base);
assert.strictEqual(proxy.getCompletionsAtPosition('/x.tsx', 0), base);
assert.strictEqual(proxy.getCompletionsAtPosition('/x.tsx', 0), base);
assert.strictEqual(programAttempts, 2, 'the open circuit must stop csszyx work');
const failureLogs = failureLogsBefore();
assert.strictEqual(failureLogs.length, 1, 'failure logs are rate limited');
assert.ok(!failureLogs[0].includes('\n'));

module.onConfigurationChanged?.({ failureThreshold: 2 });
assert.strictEqual(proxy.getCompletionsAtPosition('/x.tsx', 0), base);
assert.strictEqual(programAttempts, 3, 'configuration changes reset the circuit');

cancelled = true;
assert.strictEqual(proxy.getCompletionsAtPosition('/x.tsx', 0), base);
assert.strictEqual(programAttempts, 3, 'cancelled requests skip csszyx work');

proxy.dispose();
proxy.dispose();
assert.strictEqual(disposeCalls, 1);

console.log('proxy failure/lifecycle checks passed');

let hostileProgramAttempts = 0;
const hostileService = {
    ...service,
    getProgram: () => {
        hostileProgramAttempts += 1;
        return undefined;
    },
};
const hostileProxy = init({ typescript: ts }).create({
    config: {},
    languageService: hostileService,
    project: {
        projectService: {
            cancellationToken: {
                isCancellationRequested: () => {
                    throw new Error('host cancellation failure');
                },
            },
            logger: {
                info: () => {
                    throw new Error('host logger failure');
                },
            },
        },
    },
});
assert.strictEqual(hostileProxy.getCompletionsAtPosition('/x.tsx', 0), base);
assert.strictEqual(hostileProgramAttempts, 0, 'host API failures must fail open before csszyx work');

// Half-open recovery: an open circuit re-arms after its cooldown, so transient
// slowness (a cold checker, a loaded machine) does not disable completions for
// the whole session — the plugin retries without a configuration change.
const realNow = performance.now.bind(performance);
let clock = realNow();
performance.now = () => clock;
try {
    let attempts = 0;
    const recovering = {
        getCompletionsAtPosition: () => base,
        getCompletionEntryDetails: () => undefined,
        getProgram: () => {
            attempts += 1;
            throw new Error('transient');
        },
        dispose: () => {},
    };
    const recoveringProxy = init({ typescript: ts }).create({
        config: { failureThreshold: 2 },
        languageService: recovering,
        project: { projectService: { logger: { info: () => {} } } },
    });
    recoveringProxy.getCompletionsAtPosition('/x.tsx', 0);
    recoveringProxy.getCompletionsAtPosition('/x.tsx', 0);
    const atOpen = attempts;
    recoveringProxy.getCompletionsAtPosition('/x.tsx', 0);
    assert.strictEqual(attempts, atOpen, 'the open circuit blocks retries within the cooldown');
    clock += 31_000;
    recoveringProxy.getCompletionsAtPosition('/x.tsx', 0);
    assert.strictEqual(attempts, atOpen + 1, 'the circuit half-opens after the cooldown');
} finally {
    performance.now = realNow;
}
