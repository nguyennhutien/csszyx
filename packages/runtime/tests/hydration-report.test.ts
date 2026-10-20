/**
 * What the hydration and integrity checks print, in both builds (ADR 0031).
 *
 * Each of these lines reports csszyx's own output as wrong or unchecked, so
 * it prints in production too (ADR 0011): in development as the registry's
 * sentence, in production as its code, its args as JSON and its page. A line
 * about one element passes the element after the message in both, so the
 * browser console can reveal it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { productionMessage, runtimeMessage } from '../../compiler/tests/engine-message.js';
import {
    abortHydration,
    attemptCSRRecovery,
    clearHydrationErrors,
    computeMangleChecksumAsync,
    disableCSRRecovery,
    enableCSRRecovery,
    type HydrationErrorType,
    loadMangleMapFromDOM,
    verifyMangleChecksumAsync,
} from '../src/hydration.js';
import { loadManifestFromDOM } from '../src/verify.js';
import {
    CENSUS_UNREADABLE_LINE,
    checksumMismatchLine,
    jsonErrorOf,
    mangleMapUnreadableLine,
    manifestUnreadableLine,
    mapUnavailableLine,
    WEB_CRYPTO_LINE,
} from './helpers/hydration-lines.js';

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
    clearHydrationErrors();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    disableCSRRecovery();
    document.head.innerHTML = '';
});

/**
 * Put a script tag on the page the way a build does.
 *
 * @param id - The tag's id.
 * @param content - Its text.
 */
function script(id: string, content: string): void {
    const tag = document.createElement('script');
    tag.id = id;
    tag.type = 'application/json';
    tag.textContent = content;
    document.head.appendChild(tag);
}

describe('a mangle map on the page that does not read', () => {
    it.each([
        ['development', '{"p-4"', mangleMapUnreadableLine(jsonErrorOf('{"p-4"'))],
        ['development', '{"p-4": 1}', mangleMapUnreadableLine()],
        [
            'production',
            '{"p-4"',
            productionMessage('mangle-map-unreadable', {
                form: 'json',
                error: jsonErrorOf('{"p-4"'),
            }),
        ],
        [
            'production',
            '{"p-4": 1}',
            productionMessage('mangle-map-unreadable', { form: 'schema' }),
        ],
    ])('is reported in %s for %s', (environment, content, line) => {
        vi.stubEnv('NODE_ENV', environment);
        script('__CSSZYX_MANGLE_MAP__', content);
        expect(loadMangleMapFromDOM()).toBeNull();
        expect(error.mock.calls).toEqual([[line]]);
    });
});

describe('a recovery manifest on the page that does not read', () => {
    it.each([
        ['development', manifestUnreadableLine(jsonErrorOf('{ x'))],
        [
            'production',
            productionMessage('recovery-manifest-unreadable', {
                form: 'json',
                error: jsonErrorOf('{ x'),
            }),
        ],
    ])('is reported in %s', (environment, line) => {
        vi.stubEnv('NODE_ENV', environment);
        script('__SZ_RECOVERY_MANIFEST__', '{ x');
        expect(loadManifestFromDOM()).toBeNull();
        expect(error.mock.calls).toEqual([[line]]);
    });
});

describe('a mangle check that answers false', () => {
    const MAP = { 'p-4': 'a' };

    it.each(['development', 'production'])('says why in %s', async environment => {
        vi.stubEnv('NODE_ENV', environment);
        const production = environment === 'production';

        const computed = await computeMangleChecksumAsync(MAP);
        expect(await verifyMangleChecksumAsync('0000000000000000', MAP)).toBe(false);
        const mismatch = production
            ? productionMessage('mangle-checksum-mismatch', {
                  computed,
                  expected: '0000000000000000',
              })
            : checksumMismatchLine(computed, '0000000000000000');

        expect(await verifyMangleChecksumAsync('1111111111111111')).toBe(false);

        script('__CSSZYX_MANGLE_MAP__', '{"p-4"');
        expect(await verifyMangleChecksumAsync('2222222222222222')).toBe(false);

        vi.stubGlobal('crypto', { subtle: undefined });
        expect(await verifyMangleChecksumAsync('3333333333333333', MAP)).toBe(false);

        expect(warn.mock.calls).toEqual([
            [mismatch],
            [
                production
                    ? productionMessage('mangle-map-unavailable', { checksum: '1111111111111111' })
                    : mapUnavailableLine('1111111111111111'),
            ],
            [
                production
                    ? productionMessage('mangle-census-unreadable', {})
                    : CENSUS_UNREADABLE_LINE,
            ],
            [production ? productionMessage('web-crypto-unavailable', {}) : WEB_CRYPTO_LINE],
        ]);
    });
});

/** The sentence, advice and note of each `hydration-aborted` form. */
const ABORTED: Record<HydrationErrorType, (tag: string, message: string) => string[]> = {
    checksum_mismatch: tag => [
        `The HTML, the bundle and the recovery manifest do not all come from one build, so csszyx aborted hydration at \`<${tag}>\`.`,
        'help: deploy the HTML, the bundle and the manifest from one build.',
        'note: csszyx only marks the element with `data-sz-hydration-aborted` and `data-sz-interactive="false"`; nothing skips hydrating it unless your code checks `isHydrationAborted`.',
    ],
    map_missing: (tag, message) => [
        `Your code called \`abortHydration\` with \`map_missing\`, so csszyx aborted hydration at \`<${tag}>\`.`,
        'help: serve the page with the mangle map its build wrote.',
        `note: the caller reported: ${message}; csszyx only marks the element, and nothing skips hydrating it unless your code checks \`isHydrationAborted\`.`,
    ],
    invalid_token: (tag, message) => [
        `Your code called \`abortHydration\` with \`invalid_token\`, so csszyx aborted hydration at \`<${tag}>\`.`,
        'help: deploy the HTML and the recovery manifest from one build.',
        `note: the caller reported: ${message}; csszyx only marks the element, and nothing skips hydrating it unless your code checks \`isHydrationAborted\`.`,
    ],
};

describe('an aborted hydration', () => {
    it.each(['checksum_mismatch', 'map_missing', 'invalid_token'] as const)(
        'names the element and the reason for %s',
        type => {
            // `localName`, as the source wrote it: `tagName` upper-cases HTML.
            const element = document.createElement('section');
            abortHydration(element, { type, message: 'map gone', timestamp: 1 });
            expect(error.mock.calls).toEqual([
                [
                    runtimeMessage('hydration-aborted', ...ABORTED[type]('section', 'map gone')),
                    element,
                ],
            ]);
        },
    );

    it('prints its form, the element and the caller message in production', () => {
        vi.stubEnv('NODE_ENV', 'production');
        const first = document.createElement('div');
        const second = document.createElement('div');
        abortHydration(first, { type: 'checksum_mismatch', message: 'ignored', timestamp: 1 });
        abortHydration(second, { type: 'invalid_token', message: 'bad token', timestamp: 2 });
        expect(error.mock.calls).toEqual([
            [
                productionMessage('hydration-aborted', {
                    form: 'checksum-mismatch',
                    tagName: 'div',
                }),
                first,
            ],
            [
                productionMessage('hydration-aborted', {
                    form: 'invalid-token',
                    tagName: 'div',
                    message: 'bad token',
                }),
                second,
            ],
        ]);
    });
});

describe('a client-side recovery', () => {
    /**
     * An element the build marked for recovery.
     *
     * @param mode - Its `szRecover` mode, or none.
     * @returns The element.
     */
    function marked(mode?: string): HTMLElement {
        const element = document.createElement('div');
        if (mode !== undefined) {
            element.setAttribute('data-sz-recovery-token', 't');
            element.setAttribute('data-sz-recover', mode);
        }
        return element;
    }

    const UNMARKED = runtimeMessage(
        'csr-recovery-unmarked',
        'This element has a hydration mismatch but no `szRecover` directive, so it is not recovered on the client.',
        'help: add `szRecover="csr"` to recover it, or `szRecover="dev-only"` to recover it in development only.',
    );
    const USED = runtimeMessage(
        'csr-recovery-used',
        'A hydration mismatch on this element was recovered by rendering it on the client.',
        'help: fix the cause of the mismatch; with `szRecover="csr"`, this recovery also runs in production.',
    );

    it('says which element it refused or recovered in development', () => {
        enableCSRRecovery();
        const unmarked = marked();
        const recovered = marked('csr');
        expect(attemptCSRRecovery(unmarked)).toBe(false);
        expect(attemptCSRRecovery(recovered)).toBe(true);
        expect(warn.mock.calls).toEqual([
            [UNMARKED, unmarked],
            [USED, recovered],
        ]);
    });

    it('says the same in production, as codes', () => {
        vi.stubEnv('NODE_ENV', 'production');
        enableCSRRecovery();
        const unmarked = marked();
        const devOnly = marked('dev-only');
        const recovered = marked('csr');
        expect(attemptCSRRecovery(unmarked)).toBe(false);
        expect(attemptCSRRecovery(devOnly)).toBe(false);
        expect(attemptCSRRecovery(recovered)).toBe(true);
        expect(warn.mock.calls).toEqual([
            [productionMessage('csr-recovery-unmarked', {}), unmarked],
            [productionMessage('csr-recovery-dev-only', { form: 'runtime' }), devOnly],
            [productionMessage('csr-recovery-used', {}), recovered],
        ]);
    });
});
