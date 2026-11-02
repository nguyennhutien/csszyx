import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { afterEach, expect, it, vi } from 'vitest';

const fault = vi.hoisted(() => ({ runtime: false, warning: false }));
vi.mock('@csszyx/compiler', async original => {
    const actual = await original<typeof import('@csszyx/compiler')>();
    return {
        ...actual,
        transform: (...args: Parameters<typeof actual.transform>) => {
            if (fault.runtime) throw 'runtime unavailable';
            return actual.transform(...args);
        },
    };
});
vi.mock('@csszyx/compiler/engine', async original => {
    const actual = await original<typeof import('@csszyx/compiler/engine')>();
    return {
        ...actual,
        transformSource: (...args: Parameters<typeof actual.transformSource>) => {
            if (fault.warning) console.warn('engine warning', 42);
            return actual.transformSource(...args);
        },
    };
});
vi.mock('../src/resources/index.js', async original => ({
    ...(await original<typeof import('../src/resources/index.js')>()),
    readResource: () => {
        throw 'resource unavailable';
    },
}));
vi.mock('../src/prompts/index.js', async original => ({
    ...(await original<typeof import('../src/prompts/index.js')>()),
    getPrompt: () => {
        throw 'prompt unavailable';
    },
}));

import { server, startWhenEntrypoint } from '../src/index.js';
import { handleBatch } from '../src/tools/batch.js';
import { handleCompilePreview } from '../src/tools/compile-preview.js';
import { handleValidate } from '../src/tools/validate.js';

afterEach(() => {
    fault.runtime = false;
    fault.warning = false;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

it('preserves non-Error failures at each MCP request boundary', async () => {
    const client = new Client({ name: 'failure-test', version: '1' });
    const [left, right] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(left), server.connect(right)]);
    try {
        fault.runtime = true;
        const result = await client.callTool({
            name: 'csszyx_expand',
            arguments: { sz: {} },
        });
        expect(result).toMatchObject({
            isError: true,
            content: [{ text: expect.stringContaining('runtime unavailable') }],
        });
        await expect(client.readResource({ uri: 'csszyx://test' })).rejects.toThrow(
            'Resource error: resource unavailable',
        );
        await expect(client.getPrompt({ name: 'test' })).rejects.toThrow(
            'Prompt error: prompt unavailable',
        );
    } finally {
        await client.close();
    }
});

it('reports a non-Error runtime failure per batch item and in validation', () => {
    fault.runtime = true;
    const batch = JSON.parse(handleBatch({ items: [{}] }).content[0].text);
    expect(batch).toEqual({
        results: [{ index: 0, error: 'runtime unavailable' }],
        totalItems: 1,
        successful: 0,
    });
    const validation = JSON.parse(handleValidate({ sz: {} }).content[0].text);
    expect(validation).toMatchObject({
        valid: false,
        transformError: 'runtime unavailable',
    });
});

it('captures engine console diagnostics and restores the caller console', async () => {
    fault.warning = true;
    const warn = console.warn;
    const result = await handleCompilePreview({
        source: 'export const A = () => <div sz={{p:4}} />;',
    });
    expect(JSON.parse(result.content[0].text).diagnostics).toContain('engine warning 42');
    expect(console.warn).toBe(warn);
});

it.each([true, false])('starts stdio only without a CLI flag (flag=%s)', async flag => {
    const argv = process.argv;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const connect = vi.spyOn(server, 'connect').mockResolvedValue(undefined);
    try {
        process.argv = ['node', 'csszyx-mcp', ...(flag ? ['--version'] : [])];
        await startWhenEntrypoint(true);
        if (flag) {
            expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\d+\./));
            expect(connect).not.toHaveBeenCalled();
        } else {
            expect(connect).toHaveBeenCalledWith(expect.any(StdioServerTransport));
            expect(error).toHaveBeenCalledWith(expect.stringContaining('running on stdio'));
        }
    } finally {
        process.argv = argv;
    }
});
