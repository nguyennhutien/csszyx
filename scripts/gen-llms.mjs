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

async function main() {
    console.log('Generating llms.txt and llms-full.txt...');

    // 1. Read base template
    const templatePath = path.join(specsDir, 'llms-template.md');
    const template = await fs.readFile(templatePath, 'utf8');

    // 2. Generate llms.txt (Lite) — common props only + footer links
    const commonPropsPath = path.join(specsDir, 'llms-common-props.md');
    const commonProps = await fs.readFile(commonPropsPath, 'utf8');
    const liteContent = template.replace('{{CONTENT_SLOT}}', commonProps.trim());
    await fs.writeFile(path.join(docsPublic, 'llms.txt'), liteContent + liteFooter);

    // 3. Generate llms-full.txt — all snippets, no footer (already comprehensive)
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

    const fullContent = template.replace('{{CONTENT_SLOT}}', fullSnippetsContent.trim());
    await fs.writeFile(path.join(docsPublic, 'llms-full.txt'), fullContent);

    console.log(`Generated:
  - apps/docs/public/llms.txt
  - apps/docs/public/llms-full.txt`);
}

main().catch(console.error);
