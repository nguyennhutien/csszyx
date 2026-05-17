import { ASTBudgetExceededError } from '@csszyx/compiler';
import { describe, expect, it } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

describe('csszyx plugin include/exclude filters', () => {
    function hugeSzSource(): string {
        const literals = Array.from({ length: 60_000 }, (_, i) => i).join(', ');
        return `const data = [${literals}]; const App = () => <div sz={{ p: 1 }}>x</div>;`;
    }

    it('excludes matching source files before AST parsing', () => {
        const [prePlugin] = vitePlugin({ exclude: [/generated\/icons\.tsx$/] }) as Array<{
            transformInclude(id: string): boolean;
            transform(code: string, id: string): unknown;
        }>;
        const file = '/project/src/generated/icons.tsx';

        expect(prePlugin.transformInclude(file)).toBe(false);
        expect(() => prePlugin.transform(hugeSzSource(), file)).not.toThrow(ASTBudgetExceededError);
        expect(prePlugin.transform(hugeSzSource(), file)).toBeNull();
    });

    it('keeps non-excluded source files eligible for transform', () => {
        const [prePlugin] = vitePlugin({ exclude: [/generated/] }) as Array<{
            transformInclude(id: string): boolean;
        }>;

        expect(prePlugin.transformInclude('/project/src/App.tsx')).toBe(true);
        expect(prePlugin.transformInclude('/project/src/generated/icons.tsx')).toBe(false);
    });
});
