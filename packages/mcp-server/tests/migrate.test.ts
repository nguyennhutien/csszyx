import { describe, expect, it } from 'vitest';

import { handleMigrate } from '../src/tools/migrate';

describe('csszyx_migrate tool', () => {
    it('should transform JSX snippet from className to sz prop', async () => {
        const code = '<div className="p-4 bg-red-500" />';
        const result = handleMigrate({ code });
        const data = JSON.parse(result.content[0].text);

        expect(data.code).toContain('sz={{');
        expect(data.code).toContain('p: 4');
        expect(data.code).toContain("bg: 'red-500'");
        expect(data.changed).toBe(true);
        expect(data.stats.classNamesTransformed).toBe(1);
    });

    it('should handle complex snippets with clsx', async () => {
        const code = '<div className={clsx("p-4", condition && "bg-red-500")} />';
        const result = handleMigrate({ code });
        const data = JSON.parse(result.content[0].text);

        expect(data.code).toContain("sz={[{ p: 4 }, condition && { bg: 'red-500' }]}");
        expect(data.changed).toBe(true);
    });

    it('should apply customMap to resolve custom classes', async () => {
        const code = '<div className="p-4 btn" />';
        const result = handleMigrate({
            code,
            customMap: { btn: { px: 4, py: 2, rounded: 'md', bg: 'blue-500' } },
        });
        const data = JSON.parse(result.content[0].text);

        expect(data.changed).toBe(true);
        // custom class was resolved — should not appear as unrecognized
        expect(data.stats.unrecognized ?? []).not.toContain('btn');
    });

    it('should report unrecognized classes when customMap entry is sz:todo', async () => {
        const code = '<div className="p-4 btn" />';
        const result = handleMigrate({
            code,
            customMap: { btn: 'sz:todo' },
        });
        const data = JSON.parse(result.content[0].text);

        expect(data.stats.unrecognized).toContain('btn');
    });

    it('should inject @sz-todo comments when injectTodos is true', async () => {
        const code = '<div className="p-4 unknown-class" />';
        const result = handleMigrate({ code, injectTodos: true });
        const data = JSON.parse(result.content[0].text);

        expect(data.code).toContain('@sz-todo');
        expect(data.stats.unrecognized).toContain('unknown-class');
    });

    it('should surface a warning when a clsx() call cannot be migrated (spread argument)', async () => {
        const code = '<div className={clsx(...classes)} />';
        const result = handleMigrate({ code });
        const data = JSON.parse(result.content[0].text);

        expect(data.warnings).toBeDefined();
        expect(data.warnings[0]).toContain('Cannot migrate spread argument');
    });

    it('should flag the clsx import as potentially unused once every call site is migrated', async () => {
        const code = [
            "import clsx from 'clsx';",
            'function Comp({ isActive }) {',
            '  return <div className={clsx("p-4", isActive && "bg-blue-500")} />;',
            '}',
        ].join('\n');
        const result = handleMigrate({ code });
        const data = JSON.parse(result.content[0].text);

        expect(data.changed).toBe(true);
        expect(data.potentiallyUnusedImports).toContain('clsx');
    });
});
