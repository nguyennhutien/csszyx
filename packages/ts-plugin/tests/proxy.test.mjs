import assert from 'node:assert';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const init = require('../dist/index.js');

test('proxy fails open, rate limits failures, and recovers its circuit', () => {
let programAttempts = 0;
let disposeCalls = 0;
let detailFallbackCalls = 0;
let cancelled = false;
const logs = [];
const base = {
    isGlobalCompletion: false,
    isMemberCompletion: true,
    isNewIdentifierLocation: true,
    entries: [{ name: 'base', kind: 'var', kindModifiers: '', sortText: '1' }],
};
const service = {
    identity: 'base-service',
    getCompletionsAtPosition: () => base,
    getCompletionEntryDetails: (_fileName, _position, name) => {
        detailFallbackCalls += 1;
        return { name, kind: 'var', kindModifiers: '', displayParts: [], documentation: [] };
    },
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
assert.strictEqual(proxy.identity, 'base-service', 'non-method language-service fields survive proxying');
const failureLogsBefore = () => logs.filter(message => !message.includes('activated'));

const ownedDetails = proxy.getCompletionEntryDetails('/x.tsx', 0, 'p', undefined, undefined, undefined, {
    owner: '@csszyx/ts-plugin',
    schema: 1,
    group: 'key',
});
assert.strictEqual(ownedDetails.name, 'p');
assert.match(ownedDetails.documentation[0].text, /sz key/);
assert.strictEqual(detailFallbackCalls, 0, 'owned details never consult the base service');

const hostileDetails = proxy.getCompletionEntryDetails(
    '/x.tsx',
    0,
    'hostile',
    undefined,
    undefined,
    undefined,
    new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error('hostile metadata'); } }),
);
assert.strictEqual(hostileDetails.name, 'hostile');
assert.strictEqual(detailFallbackCalls, 1, 'malformed metadata fails open to the base service');

const foreignDetails = proxy.getCompletionEntryDetails(
    '/x.tsx',
    0,
    'foreign',
    undefined,
    undefined,
    undefined,
    { owner: 'host' },
);
assert.strictEqual(foreignDetails.name, 'foreign');
assert.strictEqual(detailFallbackCalls, 2, 'foreign details delegate to the base service');

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

let throwingLoggerAttempts = 0;
const throwingLoggerProxy = init({ typescript: ts }).create({
    config: { failureThreshold: 1 },
    languageService: {
        ...service,
        getProgram: () => {
            throwingLoggerAttempts += 1;
            throw new Error('synthetic failure');
        },
    },
    project: {
        getCurrentDirectory: () => {
            throw new Error('host project root failure');
        },
        projectService: {
            logger: { info: () => { throw new Error('host logger failure'); } },
        },
    },
});
assert.strictEqual(throwingLoggerProxy.getCompletionsAtPosition('/x.tsx', 0), base);
assert.strictEqual(throwingLoggerAttempts, 1, 'logger failures never mask completion failures');

let programlessAttempts = 0;
const programlessProxy = init({ typescript: ts }).create({
    config: {},
    languageService: {
        ...service,
        getProgram: () => {
            programlessAttempts += 1;
            return undefined;
        },
    },
    project: { projectService: { logger: { info: () => {} } } },
});
assert.strictEqual(programlessProxy.getCompletionsAtPosition('/x.tsx', 0), base);
assert.strictEqual(programlessAttempts, 1, 'a temporarily missing program is a healthy no-op');

// Correct but late results are still returned, then the deadline failure opens
// the same protective circuit as an exception.
const realDeadlineNow = performance.now.bind(performance);
const deadlineTimeline = [0, 0, 2, 2, 2];
let deadlineClockIndex = 0;
let deadlineProgramAttempts = 0;
performance.now = () =>
    deadlineTimeline[Math.min(deadlineClockIndex++, deadlineTimeline.length - 1)];
try {
    const deadlineService = {
        ...service,
        getProgram: () => {
            deadlineProgramAttempts += 1;
            return undefined;
        },
    };
    const deadlineProxy = init({ typescript: ts }).create({
        config: { deadlineMs: 1, failureThreshold: 1 },
        languageService: deadlineService,
        project: { projectService: { logger: { info: () => {} } } },
    });
    assert.strictEqual(deadlineProxy.getCompletionsAtPosition('/x.tsx', 0), base);
    assert.strictEqual(deadlineProgramAttempts, 1);
    assert.strictEqual(deadlineProxy.getCompletionsAtPosition('/x.tsx', 0), base);
    assert.strictEqual(deadlineProgramAttempts, 1, 'a deadline overrun opens the circuit');
} finally {
    performance.now = realDeadlineNow;
}

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
});

// The activation line reports each switch, and every other case here leaves
// the defaults in place — completions on, values on, theme values off. Without
// the opposite settings the off-states of the first two and the on-state of the
// third are never rendered, so a typo in the message would ship unseen.
const activationLogs = [];
init({ typescript: ts }).create({
    config: { enabled: false, values: false, themeValues: true },
    languageService: {
        getCompletionsAtPosition: () => base,
        getProgram: () => undefined,
    },
    project: {
        projectService: {
            cancellationToken: { isCancellationRequested: () => false },
            logger: { info: message => activationLogs.push(message) },
        },
    },
});
assert.ok(
    activationLogs.some(
        message =>
            message.includes('completions off') &&
            message.includes('values off') &&
            message.includes('theme values on'),
    ),
    'activation must report every switch it was given',
);
