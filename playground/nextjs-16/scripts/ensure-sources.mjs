import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = [
    [
        join(root, 'csszyx-classes.html'),
        '<!-- Tailwind @source target used by the Next 16 Turbopack source probe. -->\n',
    ],
    [
        join(root, '.csszyx/next-loader-classes.html'),
        '<!-- Next 16 csszyx Turbopack loader safelist placeholder. -->\n',
    ],
];

for (const [file, content] of files) {
    await mkdir(dirname(file), { recursive: true });
    try {
        await access(file);
    } catch {
        await writeFile(file, content);
    }
}
