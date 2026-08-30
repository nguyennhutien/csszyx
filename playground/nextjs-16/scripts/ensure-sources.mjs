import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = [
    [
        join(root, '.csszyx/csszyx-classes.txt'),
        '# Tailwind @source target used by the Next 16 Turbopack source probe.\n',
    ],
    [
        join(root, '.csszyx/next-loader-classes.txt'),
        '# Next 16 csszyx Turbopack loader safelist placeholder.\n',
    ],
    [
        join(root, '.csszyx/xmod/classes.txt'),
        '# Isolated cross-module lane safelist placeholder.\n',
    ],
];

for (const [file, content] of files) {
    await mkdir(dirname(file), { recursive: true });
    try {
        // 'wx' creates atomically and fails if the file already exists —
        // no check-then-write window for a concurrent process to exploit.
        await writeFile(file, content, { flag: 'wx' });
    } catch (error) {
        if (error?.code !== 'EEXIST') {
            throw error;
        }
    }
}
