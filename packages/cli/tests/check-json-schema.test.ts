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

/** One keyword's check: the problems an instance has against its value. */
type KeywordCheck = (rule: unknown, value: unknown, at: string) => string[];

/**
 * The problem, when there is one.
 *
 * @param broken - Whether the keyword is broken.
 * @param problem - What to say.
 * @returns The problem alone, or none.
 */
function when(broken: boolean, problem: string): string[] {
    return broken ? [problem] : [];
}

/**
 * The keywords the published schema uses. Like JSON Schema, `pattern`,
 * `minimum`, `required`, `properties` and `items` read only the instance type
 * they apply to.
 */
const KEYWORDS: Readonly<Record<string, KeywordCheck>> = {
    $ref: (rule, value, at) => {
        const defs = schema.$defs as Record<string, Schema>;
        return validate(defs[String(rule).replace('#/$defs/', '')] as Schema, value, at);
    },
    type: (rule, value, at) =>
        when(typeOf(value) !== rule, `${at}: is ${typeOf(value)}, not ${rule}`),
    const: (rule, value, at) => when(value !== rule, `${at}: is not ${JSON.stringify(rule)}`),
    enum: (rule, value, at) =>
        when(
            !(rule as unknown[]).includes(value),
            `${at}: ${JSON.stringify(value)} is not one of the enum`,
        ),
    pattern: (rule, value, at) =>
        when(
            typeof value === 'string' && !new RegExp(rule as string, 'u').test(value),
            `${at}: ${JSON.stringify(value)} does not match ${rule}`,
        ),
    minimum: (rule, value, at) =>
        when(
            typeof value === 'number' && value < (rule as number),
            `${at}: ${value} is below ${rule}`,
        ),
    required: (rule, value, at) =>
        typeOf(value) === 'object'
            ? (rule as string[]).flatMap(name =>
                  when(!(name in (value as object)), `${at}: lacks ${name}`),
              )
            : [],
    properties: (rule, value, at) =>
        typeOf(value) === 'object'
            ? Object.entries(rule as Record<string, Schema>).flatMap(([name, sub]) => {
                  const inner = (value as Record<string, unknown>)[name];
                  return inner === undefined ? [] : validate(sub, inner, `${at}/${name}`);
              })
            : [],
    items: (rule, value, at) =>
        Array.isArray(value)
            ? value.flatMap((item, index) => validate(rule as Schema, item, `${at}/${index}`))
            : [],
};

/**
 * Where an instance breaks a schema node, for the keywords the published
 * schema uses.
 *
 * @param node - The schema node.
 * @param value - The instance.
 * @param at - The instance's JSON pointer, for the message.
 * @returns One message per broken keyword.
 * @throws {Error} When the node uses a keyword this check does not read.
 */
function validate(node: Schema, value: unknown, at = ''): string[] {
    return Object.entries(node).flatMap(([keyword, rule]) => {
        if (ANNOTATIONS.has(keyword)) return [];
        const check = KEYWORDS[keyword];
        if (check === undefined) {
            throw new Error(`the schema uses ${keyword}, which this check does not read`);
        }
        return check(rule, value, at);
    });
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
