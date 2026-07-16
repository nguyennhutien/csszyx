import { describe, expect, it } from 'vitest';

import { handleTheme, themeSchema } from '../src/tools/theme';

describe('csszyx_theme tool', () => {
    it('describes quoted CSS values without literal backslashes', () => {
        expect(themeSchema.shape.css.description).toContain('--font-display: "Cal Sans";');
        expect(themeSchema.shape.css.description).not.toContain('\\"Cal Sans\\"');
    });

    it('should extract tokens from @theme blocks correctly', async () => {
        const css = `
            @theme inline {
                --color-brand-500: #ff6600;
                --spacing-lg: 2rem;
            }
        `;
        const result = handleTheme({ css });
        const data = JSON.parse(result.content[0].text);

        expect(data.theme.colors).toContain('brand');
        expect(data.theme.spacings).toContain('lg');
        expect(data.totalVariables).toBe(2);
    });

    it('should handle @theme inside @layer', async () => {
        const css = `
            @layer base {
                @theme {
                    --font-display: "Cal Sans";
                }
            }
        `;
        const result = handleTheme({ css });
        const data = JSON.parse(result.content[0].text);

        expect(data.theme.fonts).toContain('display');
        expect(data.totalVariables).toBe(1);
    });

    it('should return empty theme if no blocks found', async () => {
        const css = '.some-class { color: red; }';
        const result = handleTheme({ css });
        const data = JSON.parse(result.content[0].text);

        expect(data.totalVariables).toBe(0);
        expect(data.usage).toContain('No @theme block found');
    });
});
