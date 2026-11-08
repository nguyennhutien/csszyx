/**
 * A production loader lowers a module the prebuild did not list.
 *
 * `csszyx next prebuild` reads the files it is given (`--ignore` narrows
 * them), and Turbopack then hands the loader every module its rule matches.
 * Nothing ties the two lists together, so a module only the bundler reaches
 * must still be lowered and safelisted by the loader itself, or its `sz`
 * object reaches the DOM and its classes have no CSS.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runNextPrebuild } from '../src/next-prebuild.js';
import { writeNextStylesheetFacts } from '../src/next-stylesheet-facts.js';
import { runNextTurboLoader } from '../src/next-turbo-loader.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

const OPTIONS = {
    parserMode: 'auto' as never,
    config: { mangleVars: false },
    writeOptions: { retryDelayMs: 0 },
    nextVersion: '16.2.7',
    csszyxVersion: '0.9.0',
    compilerVersion: '0.9.0',
    nativeVersion: '0.9.0-test',
};
const UNLISTED = 'export const Late = () => <div sz={{ p: 97 }} />;\n';

afterEach(() => {
    removeTailwindProjects();
});

describe('the Next Turbopack loader and the prebuild file list', () => {
    it('lowers and safelists a module the prebuild was not given', async () => {
        const root = tailwindProject('csszyx-next-unlisted-', {
            'package.json': '{ "name": "app" }\n',
            'app/globals.css': '@import "tailwindcss";\n',
            'app/page.tsx': 'export const App = () => <div sz={{ p: 4 }} />;\n',
            'app/late/late.tsx': UNLISTED,
        });
        await writeNextStylesheetFacts({ root, cacheDir: join(root, '.csszyx/cache') });
        const prebuild = runNextPrebuild({
            files: [join(root, 'app/page.tsx')],
            explicitRoot: root,
            cwd: root,
            mode: 'production',
            ...OPTIONS,
        });

        const result = runNextTurboLoader(
            UNLISTED,
            {
                resourcePath: join(root, 'app/late/late.tsx'),
                rootContext: root,
                context: join(root, 'app/late'),
                mode: 'production',
                addDependency: () => {},
            },
            { ...OPTIONS, mode: 'production' },
        );

        expect(result.code).toContain('className="p-97"');
        expect(result.code).not.toContain('sz=');
        expect(readFileSync(prebuild.safelistOutputPath, 'utf8').split('\n')).toContain('p-97');
    }, 60_000);
});
