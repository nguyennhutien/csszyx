/**
 * An engine that cannot run is not an object that passed.
 *
 * `csszyx_validate` reads unknown keys and value problems off the engine's
 * issues. When the engine throws (a native addon from another build, an
 * artifact that is missing), there are no issues to read, and reporting the
 * object as valid tells an assistant to paste `{ bgg: 'red' }` into code.
 */
import { EngineVersionSkewError } from '@csszyx/compiler/engine';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';

import { server } from '../src/index.js';
import { handleValidate } from '../src/tools/validate';

vi.mock('@csszyx/compiler/engine', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler/engine')>();
    return {
        ...actual,
        transformSource: () => {
            throw new actual.EngineVersionSkewError(
                'The native engine was built from source `aaaa`, and `@csszyx/compiler` expects `bbbb`, so csszyx stops.',
                { form: 'source', artifact: 'native' },
            );
        },
    };
});

describe('csszyx_validate with an engine that cannot run', () => {
    it('fails the call with the engine error instead of calling the object valid', () => {
        expect(() => handleValidate({ sz: { bgg: 'red' } })).toThrow(EngineVersionSkewError);
        expect(() => handleValidate({ sz: { p: 4 } })).toThrow(/so csszyx stops/);
    });

    it('reaches the client as a tool error naming the engine', async () => {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'test-client', version: '0.0.0' });
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
        try {
            const result = await client.callTool({
                name: 'csszyx_validate',
                arguments: { sz: { bgg: 'red' } },
            });
            expect(result.isError).toBe(true);
            expect(JSON.stringify(result.content)).toMatch(
                /Error in csszyx_validate: .*so csszyx stops/,
            );
        } finally {
            await client.close();
        }
    });
});
