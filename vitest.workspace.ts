import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
    'packages/compiler',
    'packages/runtime',
    'packages/unplugin',
    'packages/core',
    'packages/cli',
    'packages/vscode',
]);
