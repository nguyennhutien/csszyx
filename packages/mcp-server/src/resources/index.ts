/**
 * MCP Resources — Expose csszyx reference data to AI agents.
 *
 * Resources are read-only data endpoints. AI agents use these to load
 * context about csszyx without needing to call tools.
 *
 * | URI                    | Content                        |
 * |------------------------|--------------------------------|
 * | csszyx://reference     | Full API reference (llms-full) |
 * | csszyx://property-map  | PROPERTY_MAP as JSON           |
 * | csszyx://variants      | standard + parametric variants |
 * | csszyx://setup         | install + framework setup guide|
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { KNOWN_VARIANTS, PROPERTY_MAP, SPECIAL_VARIANTS } from '@csszyx/compiler';

/**
 * Resolve `llms-full.txt` (shipped at the package root) by walking up from this
 * module. A fixed `../../..` guess broke once the ESM build flattened the bundle
 * to `dist/index.mjs` (2 levels to the package root, not 3) — so the resource read
 * `llms-full.txt not found` even though it is in the published package. Walking up
 * to the file works regardless of how the bundle is laid out (flat or nested).
 *
 * @returns the absolute path to `llms-full.txt` (best-effort if never found).
 */
function resolveLlmsFullPath(): string {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++) {
        const candidate = path.join(dir, 'llms-full.txt');
        if (fs.existsSync(candidate)) {
            return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }
    // Historical fallback so the path is always defined (read still error-handled).
    return path.resolve(fileURLToPath(import.meta.url), '../../..', 'llms-full.txt');
}

const LLMS_FULL_PATH = resolveLlmsFullPath();

/**
 * Project setup guide. Kept in sync with docs/installation. Exposed so an AI
 * tool wiring csszyx into an app produces a working setup — the common failure
 * modes are a missing `csszyx-env.d.ts`, `@csszyx/runtime` not being a direct
 * dependency, and a Turbopack rule with an `as` field.
 */
const SETUP_GUIDE = `# csszyx setup

Fastest path: run \`csszyx init\` (it does everything below). Manual steps:

## 1. Install
\`\`\`bash
pnpm add csszyx @csszyx/runtime
pnpm add -D @csszyx/types @csszyx/cli tailwindcss
\`\`\`
\`@csszyx/runtime\` and \`@csszyx/types\` MUST be DIRECT dependencies: the
transform injects a bare \`import { _szMerge } from '@csszyx/runtime'\`, and
\`@csszyx/types\` provides the \`sz\` JSX types. Strict package managers (pnpm) do
not resolve them transitively.

## 2. Bundler config
### Vite
\`\`\`ts
import csszyx from 'csszyx/vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ plugins: [...csszyx(), tailwindcss(), react()] });
// Order matters: csszyx BEFORE tailwindcss BEFORE react.
\`\`\`
### Next.js — webpack (full parity, recommended)
\`\`\`ts
// next.config.ts
export default {
  webpack: (config) => {
    config.plugins.push(require('@csszyx/unplugin/webpack').default());
    return config;
  },
};
// Run: next dev --webpack / next build --webpack
\`\`\`
### Next.js — Turbopack (experimental; no production class/CSS-var mangling)
\`\`\`js
// next.config.mjs
import { csszyxTurbopack } from '@csszyx/unplugin/next';
export default {
  turbopack: csszyxTurbopack({}, { safelistOutputFile: '.csszyx/next-loader-classes.html' }),
};
\`\`\`
- Do NOT set an \`as\` field on the loader rule — the helper omits it; an \`as\`
  makes the loader output self-match into \`./X.tsx.tsx\` (Module not found).
- Keep the safelist fresh: \`csszyx next watch\` (dev) and \`csszyx next prebuild\`
  before \`next build --turbopack\`. Point Tailwind \`@source\` at the safelist file.

## 3. Tailwind v4 entry
\`\`\`css
/* src/index.css */
@import "tailwindcss";
\`\`\`
Import it from your app entry.

## 4. TypeScript — enable the \`sz\` prop types
Create \`csszyx-env.d.ts\` at the project root (kept in tsconfig \`include\`):
\`\`\`ts
/// <reference types="@csszyx/types/jsx" />
\`\`\`
Without it: \`Property 'sz' does not exist on type 'DetailedHTMLProps<...>'\`.

## Usage
\`\`\`tsx
<div sz={{ p: 4, bg: 'blue-500', hover: { bg: 'blue-700' } }} />
\`\`\`

## Troubleshooting
- **"No prebuilt native binary" warning / \`native engine unavailable\`**: the
  default \`rust\` parser's native binary is missing (unsupported arch, optional
  deps omitted, or a cross-platform frozen lockfile). It is NOT broken and classes
  are UNCHANGED — all three engines (rust/oxc/babel) emit identical output
  (parity-gated). If you only use the default, csszyx auto-falls back to \`oxc\` and
  the build succeeds; ignore the warning or set \`build.parser: 'oxc'\` to silence
  it. Only an EXPLICIT \`parser:'rust'\` hard-fails. Do NOT tell the user to debug
  their styles over this.
- **A class generates no CSS**: it wasn't safelisted. The file must contain a
  statically analyzable \`sz=\` or \`szv(\` (the prescan qualifies files by those
  tokens). Arbitrary values (\`m:'20px'\`→\`m-[20px]\`) and large numbers
  (\`p:100\`→\`p-100\`) DO work — a missing class is a safelisting issue, not a
  lowering one. For a sibling workspace package, opt it in with
  \`compileSources: ['packages/name']\`. In a monorepo, scope Tailwind to the
  generated safelist file.
- **\`dynamic()\` vs build-time**: \`dynamic()\` is an escape hatch (runtime CSS
  injection, not mangled) — use ONLY for values unknown at build (JSON/API/user
  config). Literals and finite variant sets are build-time: \`sz\` / \`szv\`. To
  resolve \`szv\` output to a className by hand, use \`szr\` (build-time-safe,
  mangle-aware), not \`dynamic()\`.
`;

/** All resource URIs served by this MCP server. */
export const RESOURCE_URIS = [
    'csszyx://reference',
    'csszyx://property-map',
    'csszyx://variants',
    'csszyx://setup',
] as const;

/**
 * Return metadata for all resources served by this MCP server.
 * @returns Array of resource descriptors with URI, name, description, and mimeType.
 */
export function listResources(): Array<{
    uri: string;
    name: string;
    description: string;
    mimeType: string;
}> {
    return [
        {
            uri: 'csszyx://reference',
            name: 'CSSzyx Full Reference',
            description:
                'Complete sz prop API reference — all property mappings, variant syntax, and examples',
            mimeType: 'text/plain',
        },
        {
            uri: 'csszyx://property-map',
            name: 'CSSzyx Property Map',
            description: 'JSON mapping of sz keys to Tailwind CSS utility prefixes (PROPERTY_MAP)',
            mimeType: 'application/json',
        },
        {
            uri: 'csszyx://variants',
            name: 'CSSzyx Variant List',
            description:
                'JSON with `standard` variants (hover, focus, dark, sm, md, …) and `parametric` scope variants (group, peer, has, not, data, aria, supports) that take a nested target',
            mimeType: 'application/json',
        },
        {
            uri: 'csszyx://setup',
            name: 'CSSzyx Setup Guide',
            description:
                'How to install and wire csszyx into a project (Vite / Next.js webpack / Next.js Turbopack) — direct @csszyx/runtime + @csszyx/types deps, the sz JSX types (csszyx-env.d.ts), and the Turbopack no-`as` rule',
            mimeType: 'text/markdown',
        },
    ];
}

/**
 * Read a resource by URI and return its content.
 * @param uri - The resource URI to read (e.g. "csszyx://reference").
 * @returns MCP resource response with content array.
 */
export function readResource(uri: string): {
    contents: Array<{ uri: string; mimeType: string; text: string }>;
} {
    switch (uri) {
        case 'csszyx://reference': {
            let content =
                'CSSzyx Full Reference — llms-full.txt not found. Use csszyx_lookup tool instead.';
            try {
                content = fs.readFileSync(LLMS_FULL_PATH, 'utf-8');
            } catch {
                // File not bundled or missing — fallback message already set
            }
            return {
                contents: [{ uri, mimeType: 'text/plain', text: content }],
            };
        }

        case 'csszyx://property-map':
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(PROPERTY_MAP, null, 2),
                    },
                ],
            };

        case 'csszyx://variants':
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(
                            {
                                standard: [...KNOWN_VARIANTS].sort(),
                                parametric: [...SPECIAL_VARIANTS].sort(),
                            },
                            null,
                            2,
                        ),
                    },
                ],
            };

        case 'csszyx://setup':
            return {
                contents: [{ uri, mimeType: 'text/markdown', text: SETUP_GUIDE }],
            };

        default:
            throw new Error(`Unknown resource URI: ${uri}`);
    }
}
