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
        expect(t({ bgImg: { gradient: 'linear', dir: '25deg, red 5%...' } })).toBe('bg-linear-[25deg,_red_5%...]');
    });

    it('{ bgImg: { gradient: "linear", dir: "--var" } } → bg-linear-(--var) (css variable)', () => {
        expect(t({ bgImg: { gradient: 'linear', dir: '--var' } })).toBe('bg-linear-(--var)');
    });

    it('{ bgImg: { gradient: "linear", dir: "to-r", in: "hsl" } } → bg-linear-to-r/hsl', () => {
        expect(t({ bgImg: { gradient: 'linear', dir: 'to-r', in: 'hsl' } })).toBe('bg-linear-to-r/hsl');
    });
});

describe('backgrounds — radial gradient', () => {
    it('{ bgImg: { gradient: "radial" } } → bg-radial', () => {
        expect(t({ bgImg: { gradient: 'radial' } })).toBe('bg-radial');
    });

    it('{ bgImg: { gradient: "radial", dir: "at 50% 75%" } } → bg-radial-[at_50%_75%] (arbitrary position)', () => {
        expect(t({ bgImg: { gradient: 'radial', dir: 'at 50% 75%' } })).toBe('bg-radial-[at_50%_75%]');
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

    it('{ bgSize: "auto 100px" } → bg-[auto_100px] (arbitrary)', () => {
        expect(t({ bgSize: 'auto 100px' })).toBe('bg-[auto_100px]');
    });

    it('{ bgSize: "--bg-size" } → bg-(--bg-size) (css variable)', () => {
        expect(t({ bgSize: '--bg-size' })).toBe('bg-(--bg-size)');
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
    it('{ bgRepeat: "no-repeat" } → bg-no-repeat', () => {
        expect(t({ bgRepeat: 'no-repeat' })).toBe('bg-no-repeat');
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
