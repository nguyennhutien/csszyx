#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHostNativePackage } from '../packages/core/scripts/native-platforms.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const resolved = getHostNativePackage(repoRoot);
const { platformKey, nodePath } = resolved;

if (!nodePath) {
    console.warn(
        `[ensure-host-native] Native platform not supported or package info missing for key: ${platformKey}. Fallback to oxc/babel parser.`,
    );
    process.exit(0);
}

if (existsSync(nodePath)) {
    console.log(
        `[ensure-host-native] Native compiler binary already exists at: ${path.relative(repoRoot, nodePath)}`,
    );
    process.exit(0);
}

console.log(
    `[ensure-host-native] Native binary missing for platform ${platformKey}. Attempting to build...`,
);

// Check if cargo is in PATH
const cargoCheck = spawnSync('cargo', ['--version']);
if (cargoCheck.status !== 0) {
    console.warn(`[ensure-host-native] Warning: 'cargo' command not found in PATH.`);
    console.warn(
        `[ensure-host-native] Please install Rust toolchain (or run 'mise install') to compile native binary.`,
    );
    console.warn(
        `[ensure-host-native] Continuing build anyway. Project will fallback to JS parser ('oxc' / 'babel') unless build.parser is set to 'rust'.`,
    );
    process.exit(0);
}

// Build native binary
console.log(`[ensure-host-native] Running: pnpm --filter @csszyx/core native:build -- --clean`);
const buildResult = spawnSync(
    'pnpm',
    ['--filter', '@csszyx/core', 'native:build', '--', '--clean'],
    {
        cwd: repoRoot,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    },
);

if (buildResult.status !== 0) {
    console.error(`[ensure-host-native] Failed to compile native binary.`);
    console.warn(
        `[ensure-host-native] Warning: Project built without native Rust module. Use 'parserMode: "oxc"' in your config.`,
    );
} else {
    console.log(`[ensure-host-native] Successfully compiled and verified native binary!`);
}
