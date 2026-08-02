import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const docsPublic = path.join(root, 'apps/docs/public');
const specsDir = path.join(root, 'docs/specs');
const snippetsDir = path.join(specsDir, 'snippets');

const liteFooter = `\n---\n\nFor full reference: https://csszyx.com/llms-full.txt\nFor documentation: https://csszyx.com/docs/introduction\n`;

/**
 * Render both llms outputs from the template + snippets, without writing.
 *
 * @returns {Promise<{ file: string; content: string }[]>} target path → content
 */
async function generate() {
    // 1. Read base template
    const templatePath = path.join(specsDir, 'llms-template.md');
    const template = await fs.readFile(templatePath, 'utf8');

    // 2. llms.txt (Lite) — common props only + footer links
    const commonPropsPath = path.join(specsDir, 'llms-common-props.md');
    const commonProps = await fs.readFile(commonPropsPath, 'utf8');
    const liteContent = template.replace('{{CONTENT_SLOT}}', commonProps.trim());

    // 3. llms-full.txt — all snippets, no footer (already comprehensive)
    // Read all snippets (sort to ensure consistent order, core-concepts first)
    const snippetFiles = await fs.readdir(snippetsDir);
    const mdFiles = snippetFiles
        .filter(f => f.endsWith('.md'))
        .sort((a, b) => {
            if (a === 'core-concepts.md') return -1;
            if (b === 'core-concepts.md') return 1;
            return a.localeCompare(b);
        });

    let fullSnippetsContent = '## Full Snippets Reference\n\n';
    for (const file of mdFiles) {
        const content = await fs.readFile(path.join(snippetsDir, file), 'utf8');
        fullSnippetsContent += `${content}\n\n`;
    }

    return [
        { file: path.join(docsPublic, 'llms.txt'), content: liteContent + liteFooter },
        {
            file: path.join(docsPublic, 'llms-full.txt'),
            content: template.replace('{{CONTENT_SLOT}}', fullSnippetsContent.trim()),
        },
    ];
}

async function main() {
    const check = process.argv.includes('--check');
    const outputs = await generate();

    if (check) {
        const stale = [];
        for (const { file, content } of outputs) {
            const committed = await fs.readFile(file, 'utf8').catch(() => null);
            if (committed !== content) {
                stale.push(path.relative(root, file));
            }
        }
        if (stale.length > 0) {
            console.error(
                `Stale llms outputs (hand-edited, or template/snippets changed without a regen):\n` +
                    `${stale.map(f => `  - ${f}`).join('\n')}\n` +
                    'Run `pnpm gen:llms` and commit the result.',
            );
            process.exitCode = 1;
            return;
        }
        console.log('llms.txt and llms-full.txt are current.');
        return;
    }

    console.log('Generating llms.txt and llms-full.txt...');
    for (const { file, content } of outputs) {
        await fs.writeFile(file, content);
    }
    console.log(`Generated:
  - apps/docs/public/llms.txt
  - apps/docs/public/llms-full.txt`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
