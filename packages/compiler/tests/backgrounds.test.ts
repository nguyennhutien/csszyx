import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform.js';

const t = (sz: Parameters<typeof transform>[0]): string => transform(sz).className;

describe('backgrounds — background color', () => {
    it('{ bg: "blue-500" } → bg-blue-500', () => {
        expect(t({ bg: 'blue-500' })).toBe('bg-blue-500');
    });

    it('{ bg: "inherit" } → bg-inherit', () => {
        expect(t({ bg: 'inherit' })).toBe('bg-inherit');
    });

    it('{ bg: "transparent" } → bg-transparent', () => {
        expect(t({ bg: 'transparent' })).toBe('bg-transparent');
    });

    it('{ bg: "#333" } → bg-[#333] (arbitrary)', () => {
        expect(t({ bg: '#333' })).toBe('bg-[#333]');
    });

    it('{ bg: "--my-color" } → bg-(--my-color) (css variable)', () => {
        expect(t({ bg: '--my-color' })).toBe('bg-(--my-color)');
    });

    it('{ bg: { color: "blue-500", op: 20 } } → bg-blue-500/20 (with opacity)', () => {
        expect(t({ bg: { color: 'blue-500', op: 20 } })).toBe('bg-blue-500/20');
    });
});

describe('backgrounds — background image string patterns', () => {
    it('{ bgImg: "url(...)" } → bg-[url(...)] (arbitrary)', () => {
        expect(t({ bgImg: 'url(...)' })).toBe('bg-[url(...)]');
    });

    it('{ bgImg: "none" } → bg-none', () => {
        expect(t({ bgImg: 'none' })).toBe('bg-none');
    });

    it('{ bgImg: "--my-image" } → bg-(image:--my-image) (css variable)', () => {
        expect(t({ bgImg: '--my-image' })).toBe('bg-(image:--my-image)');
    });

    it('{ bgImg: "repeating-linear-gradient(...)" } → bg-[repeating-linear-gradient(...)]', () => {
        expect(
            t({
                bgImg: 'repeating-linear-gradient(315deg,currentColor 0,currentColor 1px,transparent 0,transparent 50%)',
            }),
        ).toBe(
            'bg-[repeating-linear-gradient(315deg,currentColor_0,currentColor_1px,transparent_0,transparent_50%)]',
        );
    });

    it('{ bgImg: "repeating-radial-gradient(...)" } → bg-[repeating-radial-gradient(...)]', () => {
        expect(t({ bgImg: 'repeating-radial-gradient(circle, red 0, blue 10px)' })).toBe(
            'bg-[repeating-radial-gradient(circle,_red_0,_blue_10px)]',
        );
    });
});

describe('backgrounds — linear gradient', () => {
    it('{ bgImg: { gradient: "linear" } } → bg-linear-to-r', () => {
        expect(t({ bgImg: { gradient: 'linear' } })).toBe('bg-linear-to-r');
    });

    it('{ bgImg: { gradient: "linear", dir: "to-b" } } → bg-linear-to-b', () => {
        expect(t({ bgImg: { gradient: 'linear', dir: 'to-b' } })).toBe('bg-linear-to-b');
    });

    it('{ bgImg: { gradient: "linear", dir: 45 } } → bg-linear-45 (angle)', () => {
        expect(t({ bgImg: { gradient: 'linear', dir: 45 } })).toBe('bg-linear-45');
    });

    it('{ bgImg: { gradient: "linear", dir: -45 } } → -bg-linear-45 (negative angle)', () => {
        expect(t({ bgImg: { gradient: 'linear', dir: -45 } })).toBe('-bg-linear-45');
    });

    it('{ bgImg: { gradient: "linear", dir: "25deg, red 5%..." } } → bg-linear-[25deg,_red_5%...] (arbitrary direction)', () => {
        expect(t({ bgImg: { gradient: 'linear', dir: '25deg, red 5%...' } })).toBe(
            'bg-linear-[25deg,_red_5%...]',
        );
    });

    it('{ bgImg: { gradient: "linear", dir: "--var" } } → bg-linear-(--var) (css variable)', () => {
        expect(t({ bgImg: { gradient: 'linear', dir: '--var' } })).toBe('bg-linear-(--var)');
    });

    it('{ bgImg: { gradient: "linear", dir: "to-r", in: "hsl" } } → bg-linear-to-r/hsl', () => {
        expect(t({ bgImg: { gradient: 'linear', dir: 'to-r', in: 'hsl' } })).toBe(
            'bg-linear-to-r/hsl',
        );
    });
});

describe('backgrounds — radial gradient', () => {
    it('{ bgImg: { gradient: "radial" } } → bg-radial', () => {
        expect(t({ bgImg: { gradient: 'radial' } })).toBe('bg-radial');
    });

    it('{ bgImg: { gradient: "radial", dir: "at 50% 75%" } } → bg-radial-[at_50%_75%] (arbitrary position)', () => {
        expect(t({ bgImg: { gradient: 'radial', dir: 'at 50% 75%' } })).toBe(
            'bg-radial-[at_50%_75%]',
        );
    });

    it('{ bgImg: { gradient: "radial", dir: "--var" } } → bg-radial-(--var) (css variable)', () => {
        expect(t({ bgImg: { gradient: 'radial', dir: '--var' } })).toBe('bg-radial-(--var)');
    });

    it('{ bgImg: { gradient: "radial", in: "oklab" } } → bg-radial/oklab', () => {
        expect(t({ bgImg: { gradient: 'radial', in: 'oklab' } })).toBe('bg-radial/oklab');
    });
});

describe('backgrounds — conic gradient', () => {
    it('{ bgImg: { gradient: "conic" } } → bg-conic', () => {
        expect(t({ bgImg: { gradient: 'conic' } })).toBe('bg-conic');
    });

    it('{ bgImg: { gradient: "conic", dir: 90 } } → bg-conic-90', () => {
        expect(t({ bgImg: { gradient: 'conic', dir: 90 } })).toBe('bg-conic-90');
    });

    it('{ bgImg: { gradient: "conic", dir: -90 } } → -bg-conic-90', () => {
        expect(t({ bgImg: { gradient: 'conic', dir: -90 } })).toBe('-bg-conic-90');
    });

    it('{ bgImg: { gradient: "conic", dir: "in hsl shorter hue, red, blue" } } → bg-conic-[in_hsl_shorter_hue,_red,_blue] (arbitrary)', () => {
        expect(t({ bgImg: { gradient: 'conic', dir: 'in hsl shorter hue, red, blue' } })).toBe(
            'bg-conic-[in_hsl_shorter_hue,_red,_blue]',
        );
    });

    it('{ bgImg: { gradient: "conic", dir: "--var" } } → bg-conic-(--var) (css variable)', () => {
        expect(t({ bgImg: { gradient: 'conic', dir: '--var' } })).toBe('bg-conic-(--var)');
    });
});

describe('backgrounds — gradient color stops', () => {
    it('{ from: "blue-500" } → from-blue-500', () => {
        expect(t({ from: 'blue-500' })).toBe('from-blue-500');
    });

    it('{ via: "blue-500" } → via-blue-500', () => {
        expect(t({ via: 'blue-500' })).toBe('via-blue-500');
    });

    it('{ to: "blue-500" } → to-blue-500', () => {
        expect(t({ to: 'blue-500' })).toBe('to-blue-500');
    });

    it('{ fromPos: 10 } → from-10%', () => {
        expect(t({ fromPos: 10 })).toBe('from-10%');
    });

    it('{ fromPos: "300px" } → from-[300px] (arbitrary)', () => {
        expect(t({ fromPos: '300px' })).toBe('from-[300px]');
    });

    it('{ fromPos: "--pos" } → from-(--pos) (css variable)', () => {
        expect(t({ fromPos: '--pos' })).toBe('from-(--pos)');
    });

    it('{ viaPos: 10 } → via-10%', () => {
        expect(t({ viaPos: 10 })).toBe('via-10%');
    });

    it('{ viaPos: "300px" } → via-[300px] (arbitrary)', () => {
        expect(t({ viaPos: '300px' })).toBe('via-[300px]');
    });

    it('{ viaPos: "--pos" } → via-(--pos) (css variable)', () => {
        expect(t({ viaPos: '--pos' })).toBe('via-(--pos)');
    });

    it('{ toPos: 10 } → to-10%', () => {
        expect(t({ toPos: 10 })).toBe('to-10%');
    });

    it('{ toPos: "300px" } → to-[300px] (arbitrary)', () => {
        expect(t({ toPos: '300px' })).toBe('to-[300px]');
    });

    it('{ toPos: "--pos" } → to-(--pos) (css variable)', () => {
        expect(t({ toPos: '--pos' })).toBe('to-(--pos)');
    });
});

describe('backgrounds — background position', () => {
    it('{ bgPos: "top-left" } → bg-top-left', () => {
        expect(t({ bgPos: 'top-left' })).toBe('bg-top-left');
    });

    it('{ bgPos: "center" } → bg-center', () => {
        expect(t({ bgPos: 'center' })).toBe('bg-center');
    });

    it('{ bgPos: "center top 1rem" } → bg-[center_top_1rem] (arbitrary)', () => {
        expect(t({ bgPos: 'center top 1rem' })).toBe('bg-[center_top_1rem]');
    });

    it('{ bgPos: "--bg-pos" } → bg-(--bg-pos) (css variable)', () => {
        expect(t({ bgPos: '--bg-pos' })).toBe('bg-(--bg-pos)');
    });
});

describe('backgrounds — background size', () => {
    it('{ bgSize: "cover" } → bg-cover', () => {
        expect(t({ bgSize: 'cover' })).toBe('bg-cover');
    });

    it('{ bgSize: "auto" } → bg-auto', () => {
        expect(t({ bgSize: 'auto' })).toBe('bg-auto');
    });

    it('{ bgSize: "contain" } → bg-contain', () => {
        expect(t({ bgSize: 'contain' })).toBe('bg-contain');
    });

    it('{ bgSize: "auto 100px" } → bg-size-[auto_100px] (arbitrary, Tailwind v4)', () => {
        expect(t({ bgSize: 'auto 100px' })).toBe('bg-size-[auto_100px]');
    });

    it('{ bgSize: "8px 8px" } → bg-size-[8px_8px] (arbitrary, Tailwind v4)', () => {
        expect(t({ bgSize: '8px 8px' })).toBe('bg-size-[8px_8px]');
    });

    it('{ bgSize: "--bg-size" } → bg-size-(--bg-size) (css variable)', () => {
        expect(t({ bgSize: '--bg-size' })).toBe('bg-size-(--bg-size)');
    });
});

describe('backgrounds — background attachment', () => {
    it('{ bgAttach: "fixed" } → bg-fixed', () => {
        expect(t({ bgAttach: 'fixed' })).toBe('bg-fixed');
    });

    it('{ bgAttach: "local" } → bg-local', () => {
        expect(t({ bgAttach: 'local' })).toBe('bg-local');
    });
});

describe('backgrounds — background clip', () => {
    it('{ bgClip: "text" } → bg-clip-text', () => {
        expect(t({ bgClip: 'text' })).toBe('bg-clip-text');
    });

    it('{ bgClip: "padding" } → bg-clip-padding', () => {
        expect(t({ bgClip: 'padding' })).toBe('bg-clip-padding');
    });
});

describe('backgrounds — background repeat', () => {
    it('{ bgRepeat: "repeat" } → bg-repeat', () => {
        expect(t({ bgRepeat: 'repeat' })).toBe('bg-repeat');
    });

    it('{ bgRepeat: "no-repeat" } → bg-no-repeat', () => {
        expect(t({ bgRepeat: 'no-repeat' })).toBe('bg-no-repeat');
    });

    it('{ bgRepeat: "x" } → bg-repeat-x (canonical TW suffix form)', () => {
        expect(t({ bgRepeat: 'x' })).toBe('bg-repeat-x');
    });

    it('{ bgRepeat: "y" } → bg-repeat-y (canonical TW suffix form)', () => {
        expect(t({ bgRepeat: 'y' })).toBe('bg-repeat-y');
    });

    it('{ bgRepeat: "repeat-x" } → bg-repeat-x (CSS value alias, same output)', () => {
        expect(t({ bgRepeat: 'repeat-x' })).toBe('bg-repeat-x');
    });

    it('{ bgRepeat: "repeat-y" } → bg-repeat-y (CSS value alias, same output)', () => {
        expect(t({ bgRepeat: 'repeat-y' })).toBe('bg-repeat-y');
    });

    it('{ bgRepeat: "space" } → bg-repeat-space', () => {
        expect(t({ bgRepeat: 'space' })).toBe('bg-repeat-space');
    });

    it('{ bgRepeat: "round" } → bg-repeat-round', () => {
        expect(t({ bgRepeat: 'round' })).toBe('bg-repeat-round');
    });
});

describe('backgrounds — background origin', () => {
    it('{ bgOrigin: "border" } → bg-origin-border', () => {
        expect(t({ bgOrigin: 'border' })).toBe('bg-origin-border');
    });

    it('{ bgOrigin: "content" } → bg-origin-content', () => {
        expect(t({ bgOrigin: 'content' })).toBe('bg-origin-content');
    });
});

describe('backgrounds — variant prefix propagation (before/after/hover)', () => {
    it('{ before: { bgPos: "center" } } → before:bg-center', () => {
        expect(t({ before: { bgPos: 'center' } })).toBe('before:bg-center');
    });

    it('{ before: { bgPos: "center top 1rem" } } → before:bg-[center_top_1rem]', () => {
        expect(t({ before: { bgPos: 'center top 1rem' } })).toBe('before:bg-[center_top_1rem]');
    });

    it('{ before: { bgPos: "--bg-pos" } } → before:bg-(--bg-pos)', () => {
        expect(t({ before: { bgPos: '--bg-pos' } })).toBe('before:bg-(--bg-pos)');
    });

    it('{ hover: { bgPos: "top-left" } } → hover:bg-top-left', () => {
        expect(t({ hover: { bgPos: 'top-left' } })).toBe('hover:bg-top-left');
    });

    it('{ before: { bgSize: "cover" } } → before:bg-cover', () => {
        expect(t({ before: { bgSize: 'cover' } })).toBe('before:bg-cover');
    });

    it('{ before: { bgSize: "8px 8px" } } → before:bg-size-[8px_8px]', () => {
        expect(t({ before: { bgSize: '8px 8px' } })).toBe('before:bg-size-[8px_8px]');
    });

    it('{ before: { bgSize: "--sz" } } → before:bg-size-(--sz)', () => {
        expect(t({ before: { bgSize: '--sz' } })).toBe('before:bg-size-(--sz)');
    });

    it('{ before: { bgImg: "none" } } → before:bg-none', () => {
        expect(t({ before: { bgImg: 'none' } })).toBe('before:bg-none');
    });

    it('{ before: { bgImg: "url(...)" } } → before:bg-[url(...)]', () => {
        expect(t({ before: { bgImg: 'url(...)' } })).toBe('before:bg-[url(...)]');
    });

    it('{ before: { bgImg: "--img" } } → before:bg-(image:--img)', () => {
        expect(t({ before: { bgImg: '--img' } })).toBe('before:bg-(image:--img)');
    });

    it('{ hover: { bgImg: "none" } } → hover:bg-none', () => {
        expect(t({ hover: { bgImg: 'none' } })).toBe('hover:bg-none');
    });

    it('{ after: { bgImg: { gradient: "linear", dir: "to-r" } } } → after:bg-linear-to-r', () => {
        expect(t({ after: { bgImg: { gradient: 'linear', dir: 'to-r' } } })).toBe(
            'after:bg-linear-to-r',
        );
    });
});
