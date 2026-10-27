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

        expect(data.theme.colors).toContain('brand-500');
        expect(data.theme.spacings).toContain('lg');
        expect(data.totalVariables).toBe(2);
    });

    it('reads and counts every namespace, and names the class a colour writes', () => {
        // vui, 0.17.2: `--animate-*` was in no category and not counted, and
        // the colour came back as `sky-a`, where the class is `bg-sky-a-400`.
        const css = `
            @theme {
                --color-sky-a-400: oklch(72.08% 0.1632 239.291);
                --animate-bulk-edit-actions-in: bulk-edit-actions-in 200ms ease-in-out;
                --text-huge: 4rem;
                --font-weight-chunky: 900;
                --breakpoint-tablet: 48rem;
                @keyframes bulk-edit-actions-in {
                    from { transform: translateY(-100%); }
                }
            }
        `;
        const data = JSON.parse(handleTheme({ css }).content[0].text);

        expect(data.theme.colors).toEqual(['sky-a-400']);
        expect(data.theme.animations).toEqual(['bulk-edit-actions-in']);
        expect(data.totalVariables).toBe(5);
        expect(data.usage).toContain("{ bg: 'brand-500' } for --color-brand-500");
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
