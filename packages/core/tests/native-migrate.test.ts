/**
 * The migrate entry points on the native binding.
 *
 * These sit in their own file because they need `getNativePackageName` to
 * name a fixture rather than the host platform: the entry points resolve the
 * binding themselves and take no package argument, so a fixture cannot be
 * handed to them the way `loadNativeBinding` accepts one. Mocking that
 * resolver is file-wide, which would take the rest of the loader suite with
 * it.
 *
 * They also cover a case no other test can reach on a developer machine. The
 * version check exists for an install whose platform package predates
 * migrate, and a machine with a current binding never takes that branch — so
 * without a fixture standing in for the old package, the error a user would
 * actually see is never executed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const packageName = vi.hoisted(() => ({ current: '' }));

vi.mock('../native/platforms.js', () => ({
    getNativePackageName: () => packageName.current,
}));

const fixture = (name: string) => new URL(`fixtures/${name}`, import.meta.url).pathname;

describe('@csszyx/core/native migrate entry points', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('forwards to the binding and returns what it answers', async () => {
        packageName.current = fixture('native-binding-migrate.cjs');
        const { migrateBatch, migrateHtml, migrateClassName, migrateParseClass } = await import(
            '../native/index.js'
        );

        expect(migrateBatch([{ filename: 'App.tsx', source: '' }], { injectTodos: true })).toEqual({
            called: 'migrateBatch',
            files: [{ filename: 'App.tsx', source: '' }],
            options: { injectTodos: true },
        });
        expect(migrateHtml('<div class="p-4"></div>', { injectTodos: false })).toEqual({
            called: 'migrateHtml',
            source: '<div class="p-4"></div>',
            options: { injectTodos: false },
        });
        // The class-level entry points answer as JSON because an sz value is
        // recursive and order-sensitive.
        expect(JSON.parse(migrateClassName('p-4', '{"btn":{}}'))).toEqual({
            called: 'migrateClassName',
            className: 'p-4',
            customMapJson: '{"btn":{}}',
        });
        expect(JSON.parse(migrateParseClass('p-4'))).toEqual({
            called: 'migrateParseClass',
            className: 'p-4',
        });
    });

    it('names the package and the missing export when the binding predates migrate', async () => {
        // A binding that loads is not a binding that can migrate: the platform
        // packages shipped before these exports existed, and calling straight
        // through would fail as "binding.migrateBatch is not a function",
        // which says nothing about updating the platform package.
        packageName.current = fixture('native-binding.cjs');
        const {
            migrateBatch,
            migrateHtml,
            migrateClassName,
            migrateParseClass,
            CsszyxNativeUnavailableError,
        } = await import('../native/index.js');

        for (const [call, exportName] of [
            [() => migrateBatch([], {}), 'migrateBatch'],
            [() => migrateHtml('', {}), 'migrateHtml'],
            [() => migrateClassName('p-4'), 'migrateClassName'],
            [() => migrateParseClass('p-4'), 'migrateParseClass'],
        ] as const) {
            expect(call).toThrow(CsszyxNativeUnavailableError);
            try {
                call();
            } catch (err) {
                const error = err as InstanceType<typeof CsszyxNativeUnavailableError>;
                expect(error.message).toContain('predates migrate');
                expect(error.message).toContain(`${exportName}()`);
                expect(error.message).toContain('native-binding.cjs');
                expect(error.packageName).toBe(packageName.current);
            }
        }
    });

    it('does not offer the wasm engine when the platform package is missing', async () => {
        // migrate has no wasm artifact: the feature is deliberately outside
        // `native-engine`, which is what the wasm parser is built with. The
        // transform's own message offers `build.parser: "wasm"` because for a
        // transform that is a real answer; repeating it here would send a user
        // whose only recourse is the platform package to a build option that
        // does not apply to the command they ran.
        packageName.current = '@csszyx/core-nonexistent-platform';
        const { migrateBatch, CsszyxNativeUnavailableError } = await import('../native/index.js');

        expect(migrateBatch).toThrow(CsszyxNativeUnavailableError);
        try {
            migrateBatch([], {});
        } catch (err) {
            const error = err as InstanceType<typeof CsszyxNativeUnavailableError>;
            expect(error.message).not.toContain('build.parser');
            expect(error.message).not.toContain('wasm');
            expect(error.message).toContain('@csszyx/core-nonexistent-platform');
            expect(error.message).toContain('migrate');
        }
    });
});
