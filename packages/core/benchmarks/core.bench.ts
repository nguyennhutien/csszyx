import crypto from 'node:crypto';
import { bench, describe } from 'vitest';
import { init, transform_sz, WasmCollisionDetector } from '../pkg-node/csszyx_core.js';

/**
 * Pure JavaScript implementation of the transformer (from @csszyx/compiler).
 */
function transformJS(szProp: any, prefix = ''): string {
    const classes: string[] = [];

    for (const [key, value] of Object.entries(szProp)) {
        if (value === false || value === null || value === undefined) {
            continue;
        }

        if (typeof value === 'object' && !Array.isArray(value)) {
            const nestedPrefix = prefix ? `${prefix}${key}:` : `${key}:`;
            classes.push(transformJS(value, nestedPrefix));
            continue;
        }

        let className = '';
        if (prefix) {
            className += prefix;
        }

        if (value === true) {
            className += key;
        } else if (typeof value === 'number' || typeof value === 'string') {
            className += `${key}-${value}`;
        }

        if (className) {
            classes.push(className);
        }
    }

    return classes.filter(Boolean).join(' ');
}

/**
 * JS implementation of Collision Detector.
 */
class JSCollisionDetector {
    map = new Map<string, string>();
    add(value: string) {
        if (this.map.has(value)) return this.map.get(value);
        const hash = crypto.createHash('sha256').update(value).digest('hex').substring(0, 6);
        const name = `--v-${hash}`;
        this.map.set(value, name);
        return name;
    }
}

describe('Core Performance Analysis', async () => {
    await init();

    const complexObject = {
        p: 4,
        m: -2,
        bg: 'blue-500',
        hover: {
            scale: 110,
            text: 'white',
            focus: {
                ring: 2,
                ringColor: 'blue-400',
            },
        },
        md: {
            p: 8,
            lg: {
                m: 0,
            },
        },
    };

    describe('Transformer: Complex Object', () => {
        bench('Rust (WASM)', () => {
            transform_sz(complexObject);
        });

        bench('JavaScript', () => {
            transformJS(complexObject);
        });
    });

    describe('Collision Detector: 1000 items', () => {
        bench('Rust (WASM)', () => {
            const detector = new WasmCollisionDetector();
            for (let i = 0; i < 1000; i++) {
                detector.add(`value-${i}`);
            }
        });

        bench('JavaScript', () => {
            const detector = new JSCollisionDetector();
            for (let i = 0; i < 1000; i++) {
                detector.add(`value-${i}`);
            }
        });
    });
});
