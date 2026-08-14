import { beforeAll, describe, expect, it } from 'vitest';
import {
    compute_mangle_checksum,
    encode,
    generate_token,
    init,
    transform_sz,
    verify_mangle_checksum,
    verify_token,
} from '../pkg-node/csszyx_core.js';

/**
 * Integration tests for @csszyx/core WASM module.
 */
describe('@csszyx/core Integration', () => {
    beforeAll(async () => {
        // init is called automatically by wasm-bindgen start in bundler target,
        // but we keep it here for compatibility or explicit triggers.
        init();
    });

    describe('Mangle Checksum', () => {
        const testMap = {
            'p-4': 'a',
            'bg-red-500': 'b',
            'm-2': 'c',
        };

        it('should compute deterministic checksums', () => {
            const checksum1 = compute_mangle_checksum(testMap);
            const checksum2 = compute_mangle_checksum(testMap);
            expect(checksum1).toBe(checksum2);
            expect(checksum1).toHaveLength(16);
        });

        it('should detect map changes', () => {
            const checksum1 = compute_mangle_checksum(testMap);
            const checksum2 = compute_mangle_checksum({ ...testMap, 'p-4': 'z' });
            expect(checksum1).not.toBe(checksum2);
        });

        it('should verify checksums correctly', () => {
            const checksum = compute_mangle_checksum(testMap);
            expect(verify_mangle_checksum(testMap, checksum)).toBe(true);
            expect(verify_mangle_checksum(testMap, 'incorrect')).toBe(false);
        });

        it('should handle large maps (1000+ entries)', () => {
            const build = (entries: number): Record<string, string> => {
                const map: Record<string, string> = {};
                for (let i = 0; i < entries; i++) {
                    map[`class-${i}`] = `m-${i}`;
                }
                return map;
            };
            // Fastest of several runs, after a warm-up call. The previous form
            // timed one cold call against a fixed millisecond budget, which
            // measured the machine rather than the code: the first call into
            // WASM pays instantiation and JIT costs that do not depend on the
            // map at all, and the same work that takes about a millisecond
            // here was billed 120 ms on a shared CI runner. Taking the minimum
            // of repeated warm runs leaves the map size as the only variable.
            const fastestOf = (map: Record<string, string>): number => {
                compute_mangle_checksum(map);
                let best = Number.POSITIVE_INFINITY;
                for (let run = 0; run < 5; run++) {
                    const start = performance.now();
                    compute_mangle_checksum(map);
                    best = Math.min(best, performance.now() - start);
                }
                return best;
            };

            const small = build(2_000);
            const large = build(16_000);
            expect(compute_mangle_checksum(small)).toHaveLength(16);
            expect(compute_mangle_checksum(large)).toHaveLength(16);

            // Eight times the entries costs about eight times the work while
            // the cost stays linear, and about sixty-four times once it does
            // not. The bound sits between the two, far enough above linear to
            // survive a noisy runner and far enough below quadratic to fail
            // the regression this guards against.
            expect(fastestOf(large)).toBeLessThan(fastestOf(small) * 20);
        });
    });

    describe('Transformer', () => {
        it('should handle negative values correctly', () => {
            expect(transform_sz({ m: -4 })).toBe('-m-4');
            expect(transform_sz({ my: -2.5 })).toBe('-my-2.5');
        });

        it('should suppress string slash opacity (use { color, op } object form)', () => {
            // String slash opacity is not supported — TypeScript compiler warns + suppresses,
            // Rust suppresses at WASM level. Neither path should emit a class.
            expect(transform_sz({ bg: 'red-500/50' })).toBe('');
            expect(transform_sz({ text: 'blue-600/75' })).toBe('');
            expect(transform_sz({ bg: 'brand-500/20' })).toBe('');
        });

        it('should pass through valid color strings without slash', () => {
            expect(transform_sz({ bg: 'red-500' })).toBe('bg-red-500');
            expect(transform_sz({ bg: 'brand-500' })).toBe('bg-brand-500');
        });

        it('should format whole numbers without decimals', () => {
            expect(transform_sz({ p: 4 })).toBe('p-4');
            expect(transform_sz({ m: 0 })).toBe('m-0');
        });

        it('should process nested variants (hover, focus)', () => {
            const result = transform_sz({
                p: 4,
                hover: {
                    bg: 'blue-500',
                    focus: { scale: 110 },
                },
            });
            expect(result).toContain('p-4');
            expect(result).toContain('hover:bg-blue-500');
            expect(result).toContain('hover:focus:scale-110');
        });
    });

    describe('Encoder', () => {
        it('should follow reversed tier-based sequence (z→y→x)', () => {
            expect(encode(0)).toBe('z');
            expect(encode(1)).toBe('y');
            expect(encode(25)).toBe('a');
        });

        it('should never start with digit (CSS compliance)', () => {
            // Check first 1000 encodings
            for (let i = 0; i < 1000; i++) {
                const encoded = encode(i);
                expect(encoded[0]).toMatch(/[a-z]/i);
            }
        });

        it('should encode indices correctly across all tiers', () => {
            expect(encode(26)).toBe('Z'); // Tier 1 middle
            expect(encode(51)).toBe('A'); // Tier 1 end
            expect(encode(52)).toBe('z9'); // Tier 2 starts
            expect(encode(572)).toBe('zz'); // Tier 3 starts
        });
    });

    describe('Security Tokens', () => {
        it('should verify tokens correctly', () => {
            const args = [
                'DataTable',
                '/src/components/DataTable.tsx',
                42,
                8,
                'csr',
                'build-123',
            ] as const;

            const token = generate_token(...args);
            expect(token).toHaveLength(12);
            expect(verify_token(token, ...args)).toBe(true);
            expect(verify_token('wrong-token', ...args)).toBe(false);
        });
    });
});
