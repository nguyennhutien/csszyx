/**
 * `csszyx check --json` against the JSON Schema it names in `$schema`.
 *
 * The schema is published from the docs site at the URL the document carries,
 * so a consumer can validate what it reads. This holds the two together: real
 * output from a project with findings of every kind the fixture can raise must
 * pass the schema, and every field a finding carries must be one the schema
 * describes.
 *
 * The repository has no JSON Schema validator among its declared
 * dependencies, so the check below implements the keywords the schema uses,
 * and refuses any other, so a keyword added to the schema cannot pass here
 * unread.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { check } from '../src/commands/check.js';
import { CHECK_REPORT_SCHEMA, CHECK_RULES } from '../src/scanner/check-report.js';
import { removeTailwindProjects, tailwindProject } from './helpers/tailwind-project.js';

const SCHEMA_PATH = path.resolve(
    import.meta.dirname,
    '../../../apps/docs/public/schemas/check-v2.json',
);

/** A JSON Schema node, as far as this file reads one. */
type Schema = Record<string, unknown>;

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Schema;

/** Keywords that only describe; they constrain nothing. */
const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', '$defs']);

/**
 * The JSON type of a value, as JSON Schema names it.
 *
 * @param value - The value.
 * @returns Its type.
 */
function typeOf(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (Number.isInteger(value)) return 'integer';
    return typeof value;
}

/**
 * Where an instance breaks a schema node, for the keywords the published
 * schema uses.
 *
 * @param node - The schema node.
 * @param value - The instance.
 * @param at - The instance's JSON pointer, for the message.
 * @returns One message per broken keyword.
 */
function validate(node: Schema, value: unknown, at = ''): string[] {
    const problems: string[] = [];
    for (const [keyword, rule] of Object.entries(node)) {
        if (ANNOTATIONS.has(keyword)) continue;
        switch (keyword) {
            case '$ref': {
                const name = String(rule).replace('#/$defs/', '');
                const defs = schema.$defs as Record<string, Schema>;
                problems.push(...validate(defs[name] as Schema, value, at));
                break;
            }
            case 'type': {
                const actual = typeOf(value);
                if (actual !== rule) {
                    problems.push(`${at}: is ${actual}, not ${rule}`);
                }
                break;
            }
            case 'const':
                if (value !== rule) problems.push(`${at}: is not ${JSON.stringify(rule)}`);
                break;
            case 'enum':
                if (!(rule as unknown[]).includes(value)) {
                    problems.push(`${at}: ${JSON.stringify(value)} is not one of the enum`);
                }
                break;
            case 'pattern':
                if (typeof value === 'string' && !new RegExp(rule as string, 'u').test(value)) {
                    problems.push(`${at}: ${JSON.stringify(value)} does not match ${rule}`);
                }
                break;
            case 'minimum':
                if (typeof value === 'number' && value < (rule as number)) {
                    problems.push(`${at}: ${value} is below ${rule}`);
                }
                break;
            // Like JSON Schema, these read only the instance type they apply to.
            case 'required':
                if (typeOf(value) !== 'object') break;
                for (const name of rule as string[]) {
                    if (!(name in (value as object))) problems.push(`${at}: lacks ${name}`);
                }
                break;
            case 'properties':
                if (typeOf(value) !== 'object') break;
                for (const [name, sub] of Object.entries(rule as Record<string, Schema>)) {
                    const inner = (value as Record<string, unknown>)[name];
                    if (inner !== undefined)
                        problems.push(...validate(sub, inner, `${at}/${name}`));
                }
                break;
            case 'items':
                if (!Array.isArray(value)) break;
                for (const [index, item] of (value as unknown[]).entries()) {
                    problems.push(...validate(rule as Schema, item, `${at}/${index}`));
                }
                break;
            default:
                throw new Error(`the schema uses ${keyword}, which this check does not read`);
        }
    }
    return problems;
}

afterEach(() => {
    removeTailwindProjects();
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

describe('the check --json schema', () => {
    it('is the one the document names', () => {
        expect(schema.$id).toBe(CHECK_REPORT_SCHEMA);
        const properties = schema.properties as Record<string, Schema>;
        expect(properties.$schema?.const).toBe(CHECK_REPORT_SCHEMA);
    });

    it('names every pass check runs, as `rule`', () => {
        const finding = (schema.$defs as Record<string, Schema>).finding as Schema;
        const rule = (finding.properties as Record<string, Schema>).rule as Schema;
        expect(rule.enum).toEqual([...CHECK_RULES]);
    });

    it('accepts what check writes, and describes every field a finding carries', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";\n@theme {\n  --color-balance: #0af;\n}\n',
            'src/App.tsx': [
                'export const A = () => <div sz={{ workBreak: 4, padding: 4 }} />;',
                "export const B = () => <div sz={{ pointer: 'none' }} />;",
            ].join('\n'),
        });
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await check({ cwd, json: true });
        const report = JSON.parse(log.mock.calls.map(call => call.join(' ')).join('\n'));

        expect(validate(schema, report)).toEqual([]);
        const rules = new Set(report.findings.map((finding: { rule: string }) => finding.rule));
        expect([...rules].sort()).toEqual(
            ['dead-class', 'sz-diagnostic', 'theme-collision'].sort(),
        );
        const described = Object.keys(
            ((schema.$defs as Record<string, Schema>).finding as Schema).properties as object,
        );
        const carried = new Set(report.findings.flatMap((finding: object) => Object.keys(finding)));
        for (const field of carried) expect(described).toContain(field);
        expect(carried).toContain('help');
        expect(carried).toContain('note');
    });

    it('refuses a document that breaks it', () => {
        const finding = {
            rule: 'nope',
            kind: 'Not_Kebab',
            line: 0,
            message: 4.5,
            url: 'https://example.com/e/x',
            level: 'off',
        };
        const problems = validate(schema, {
            $schema: CHECK_REPORT_SCHEMA,
            version: 1,
            findings: [finding, 'text'],
        });
        expect(problems).toEqual([
            '/version: is not 2',
            '/findings/0/rule: "nope" is not one of the enum',
            '/findings/0/kind: "Not_Kebab" does not match ^[a-z][a-z0-9]*(-[a-z0-9]+)*$',
            '/findings/0/line: 0 is below 1',
            '/findings/0/message: is number, not string',
            '/findings/0/url: "https://example.com/e/x" does not match ^https://csszyx\\.com/e/[a-z0-9-]+$',
            '/findings/0/level: "off" is not one of the enum',
            '/findings/1: is string, not object',
        ]);
        expect(validate(schema, { version: 2, findings: [] })).toEqual([': lacks $schema']);
        expect(validate(schema, [])).toContain(': is array, not object');
        expect(() => validate({ oneOf: [] }, {})).toThrow(/uses oneOf/);
    });
});
