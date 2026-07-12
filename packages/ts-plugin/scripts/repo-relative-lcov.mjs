// Rewrite the c8 lcov's SF entries from package-relative (src/...) to
// repo-relative (packages/ts-plugin/src/...). Codecov and SonarCloud resolve
// SF paths against the repository root, so package-relative entries attribute
// to non-existent files and the report is silently dropped.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const lcovPath = join(dirname(fileURLToPath(import.meta.url)), '../coverage/lcov.info');
const rewritten = readFileSync(lcovPath, 'utf8').replace(
    /^SF:src\//gm,
    'SF:packages/ts-plugin/src/',
);
writeFileSync(lcovPath, rewritten);
console.log('lcov SF paths rewritten to repo-relative');
