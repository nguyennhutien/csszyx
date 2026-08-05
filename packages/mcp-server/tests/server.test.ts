/**
 * Drives the server module in-process (subprocess stdio tests can't be measured
 * for coverage): the CLI-flag handling directly, and every request handler
 * through a real MCP client linked by an in-memory transport.
 */

import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleCliFlags, isEntrypoint, server, TOOLS } from '../src/index.js';

describe('handleCliFlags', () => {
    afterEach(() => vi.restoreAllMocks());

    it('prints the version and signals a stop for --version/-v', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        expect(handleCliFlags(['--version'])).toBe(true);
        expect(handleCliFlags(['-v'])).toBe(true);
        expect(log).toHaveBeenCalled();
    });

    it('prints usage for --help/-h', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        expect(handleCliFlags(['--help'])).toBe(true);
        expect(handleCliFlags(['-h'])).toBe(true);
        expect(log).toHaveBeenCalled();
    });

    it('lets the server start when no flag is present', () => {
        expect(handleCliFlags([])).toBe(false);
        expect(handleCliFlags(['--unknown'])).toBe(false);
    });
});

describe('MCP request handlers over an in-memory transport', () => {
    let client: Client;

    beforeAll(async () => {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        client = new Client({ name: 'test-client', version: '0.0.0' });
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    });

    afterAll(async () => {
        await client.close();
    });

    it('lists every registered tool', async () => {
        const { tools } = await client.listTools();
        expect(tools).toHaveLength(TOOLS.length);
        expect(tools.some(tool => tool.name === 'csszyx_lookup')).toBe(true);
    });

    it('compiles a source module through the registered preview tool', async () => {
        const result = await client.callTool({
            name: 'csszyx_compile_preview',
            arguments: { source: 'export const A = () => <div sz={{ p: 4 }} />;' },
        });
        expect(result.isError).toBeFalsy();
        const content = result.content as Array<{ text: string }>;
        expect(JSON.parse(content[0].text).classes).toEqual(['p-4']);
    });

    it('calls a tool and returns its result', async () => {
        const result = await client.callTool({
            name: 'csszyx_lookup',
            arguments: { query: 'bg' },
        });
        expect(result.isError).toBeFalsy();
        expect(Array.isArray(result.content)).toBe(true);
    });

    it('returns an isError result when a tool argument fails validation', async () => {
        const result = await client.callTool({
            name: 'csszyx_lookup',
            arguments: { query: 123 },
        });
        expect(result.isError).toBe(true);
    });

    it('rejects a call to an unknown tool', async () => {
        await expect(client.callTool({ name: 'csszyx_nope', arguments: {} })).rejects.toThrow(
            /Unknown tool/,
        );
    });

    it('lists and reads every reference resource', async () => {
        const { resources } = await client.listResources();
        expect(resources.length).toBeGreaterThan(0);
        for (const resource of resources) {
            const read = await client.readResource({ uri: resource.uri });
            expect(read.contents[0]?.text).toBeTruthy();
        }
    });

    it('rejects reading an unknown resource uri', async () => {
        await expect(client.readResource({ uri: 'csszyx://does-not-exist' })).rejects.toThrow(
            /Resource error/,
        );
    });

    it('lists prompts and fills one in with arguments', async () => {
        const { prompts } = await client.listPrompts();
        expect(prompts.some(prompt => prompt.name === 'migrate_component')).toBe(true);
        for (const name of ['migrate_component', 'create_component']) {
            const argument = name === 'migrate_component' ? 'code' : 'description';
            const got = await client.getPrompt({ name, arguments: { [argument]: 'x' } });
            expect(got.messages.length).toBeGreaterThan(0);
        }
    });

    it('rejects getting an unknown prompt', async () => {
        await expect(client.getPrompt({ name: 'nope', arguments: {} })).rejects.toThrow(
            /Prompt error/,
        );
    });

    it('fills a prompt in with its fallback text when the client omits arguments entirely', async () => {
        const got = await client.getPrompt({ name: 'migrate_component' });
        expect(got.messages[0]?.content).toMatchObject({
            text: expect.stringContaining('// paste your component here'),
        });
    });
});

describe('isEntrypoint', () => {
    const original = process.argv[1];
    afterEach(() => {
        process.argv[1] = original;
    });

    it('is false without an entry argument', () => {
        process.argv[1] = '';
        expect(isEntrypoint()).toBe(false);
    });

    it('is false when the entry path does not resolve', () => {
        process.argv[1] = '/no/such/path-abc123';
        expect(isEntrypoint()).toBe(false);
    });

    it('is false when a different module is the entry', () => {
        process.argv[1] = fileURLToPath(import.meta.url);
        expect(isEntrypoint()).toBe(false);
    });
});
