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
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { KNOWN_VARIANTS, PROPERTY_MAP, SPECIAL_VARIANTS } from '@csszyx/compiler';

// Resolve llms-full.txt relative to the package root, not CWD.
// Works whether the package is installed globally, locally, or run from monorepo.
const packageRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
const LLMS_FULL_PATH = path.join(packageRoot, 'llms-full.txt');

/** All resource URIs served by this MCP server. */
export const RESOURCE_URIS = [
    'csszyx://reference',
    'csszyx://property-map',
    'csszyx://variants',
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

        default:
            throw new Error(`Unknown resource URI: ${uri}`);
    }
}
