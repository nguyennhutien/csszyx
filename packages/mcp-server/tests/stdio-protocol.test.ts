/**
 * End-to-end stdio protocol smoke against the built server binary.
 *
 * MCP over stdio requires stdout to carry JSON-RPC messages only. The
 * 0.9.9 release shipped a server whose `@csszyx/cli` import printed the
 * CLI help to stdout before the transport started, breaking every npx
 * consumer — this spawns the real dist entry to keep that path covered.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const serverEntry = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'dist',
    'index.mjs',
);

const initializeRequest = `${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'stdio-protocol-test', version: '1.0.0' },
    },
})}\n`;

describe('stdio protocol', () => {
    it('answers initialize with JSON-RPC only on stdout', async () => {
        const child = spawn(process.execPath, [serverEntry], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => {
            stdout += chunk;
        });
        child.stderr.on('data', chunk => {
            stderr += chunk;
        });

        const exitCode = await new Promise<number | null>((resolve, reject) => {
            child.on('error', reject);
            child.on('close', code => resolve(code));
            child.stdin.write(initializeRequest);
            child.stdin.end();
        });

        expect(exitCode, `stderr was:\n${stderr}`).toBe(0);

        const lines = stdout.split('\n').filter(line => line.trim().length > 0);
        expect(lines.length).toBeGreaterThan(0);
        // Every stdout line must be a JSON-RPC message — any stray text
        // (e.g. CLI help) corrupts the stream for MCP clients.
        const messages = lines.map(line => JSON.parse(line));
        expect(messages[0].result.serverInfo.name).toBe('csszyx-mcp-server');
        expect(messages[0].result.protocolVersion).toBe('2024-11-05');
    }, 30_000);
});
