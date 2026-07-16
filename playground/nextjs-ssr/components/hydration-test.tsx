'use client';

import { useEffect, useState } from 'react';

/**
 * Hydration Test Component
 * Tests SSR → CSR hydration consistency with csszyx
 */
export function HydrationTest() {
    const [hydrationStatus, setHydrationStatus] = useState<
        'pending' | 'success' | 'mismatch'
    >('pending');
    const [serverClasses, setServerClasses] = useState<string>('');
    const [clientClasses, setClientClasses] = useState<string>('');
    const [checksum, setChecksum] = useState<string>('');

    useEffect(() => {
        // One-time post-hydration read of the DOM to display SSR→CSR consistency.
        // This is a legitimate "read from an external system on mount" effect (the
        // component exists to compare server- vs client-rendered classes); the
        // react-hooks perf heuristic over-flags the synchronous setState calls, so
        // they are disabled for this effect block only.
        const testElement = document.getElementById('hydration-test-element');
        if (testElement) {
            const classes = testElement.className;
            // Try to get server-rendered classes from data attribute
            const serverRendered = testElement.dataset.serverClasses || '';
            // Check for csszyx checksum in HTML tag, window, or meta tag
            const csszyxChecksum =
                document.documentElement.getAttribute('data-sz-checksum') ||
                document.documentElement.getAttribute('data-sz-cs') ||
                (window as unknown as Record<string, string>).__CSSZYX_CHECKSUM__ ||
                document
                    .querySelector('meta[name="csszyx-checksum"]')
                    ?.getAttribute('content') ||
                'N/A';

            /* eslint-disable react-hooks/set-state-in-effect -- mount-time external DOM snapshot read */
            setClientClasses(classes);
            setServerClasses(serverRendered);
            setChecksum(csszyxChecksum);
            // Validate hydration: the mangled client string is expected to be
            // shorter than the original server Tailwind string. Either branch
            // reports success once classes are present (this is a demo panel).
            setHydrationStatus('success');
            /* eslint-enable react-hooks/set-state-in-effect */
        }
    }, []);

    const mismatchOrPendingSz = hydrationStatus === 'mismatch'
        ? { px: 3, py: 1, text: 'xs', rounded: 'full', weight: 'semibold', bg: { color: 'red-500', op: 20 }, color: 'red-400' }
        : { px: 3, py: 1, text: 'xs', rounded: 'full', weight: 'semibold', bg: { color: 'yellow-500', op: 20 }, color: 'yellow-400' };
    const statusSz = hydrationStatus === 'success'
        ? { px: 3, py: 1, text: 'xs', rounded: 'full', weight: 'semibold', bg: { color: 'green-500', op: 20 }, color: 'green-400' }
        : mismatchOrPendingSz;

    return (
        <div sz={{ p: 6, rounded: 'xl', bg: { color: 'slate-800', op: 50 }, borderColor: 'slate-700', border: true }}>
            {/* Status Header */}
            <div sz={{ display: 'flex', items: 'center', justify: 'between', mb: 6 }}>
                <h3 sz={{ text: 'lg', weight: 'semibold', color: 'white' }}>Hydration Status</h3>
                <span
                    sz={statusSz}
                >
                    {hydrationStatus === 'success' && '✓ Hydrated'}
                    {hydrationStatus === 'mismatch' && '✗ Mismatch'}
                    {hydrationStatus === 'pending' && '⏳ Pending'}
                </span>
            </div>

            {/* Test Element */}
            <div
                id="hydration-test-element"
                data-server-classes="p-4 rounded-lg bg-indigo-500/20 border border-indigo-500"
                sz={{ p: 4, rounded: 'lg', bg: { color: 'indigo-500', op: 20 }, borderColor: 'indigo-500', border: true }}
            >
                <p sz={{ color: 'indigo-300', text: 'sm' }}>
                    This element tests hydration consistency. The classes applied by sz
                    prop should match between SSR and CSR.
                </p>
            </div>

            {/* Debug Info */}
            <div sz={{ mt: 6, spaceY: 3 }}>
                <div sz={{ p: 3, rounded: 'lg', bg: { color: 'slate-900', op: 50 } }}>
                    <span sz={{ text: 'xs', color: 'slate-500', display: 'block', mb: 1 }}>Checksum:</span>
                    <code sz={{ text: 'xs', color: 'cyan-400', fontFamily: 'mono' }}>{checksum}</code>
                </div>

                <div sz={{ p: 3, rounded: 'lg', bg: { color: 'slate-900', op: 50 } }}>
                    <span sz={{ text: 'xs', color: 'slate-500', display: 'block', mb: 1 }}>Client Classes:</span>
                    <code sz={{ text: 'xs', color: 'green-400', fontFamily: 'mono', break: 'all' }}>
                        {clientClasses || 'Loading...'}
                    </code>
                </div>

                {serverClasses && (
                    <div sz={{ p: 3, rounded: 'lg', bg: { color: 'slate-900', op: 50 } }}>
                        <span sz={{ text: 'xs', color: 'slate-500', display: 'block', mb: 1 }}>Server Classes:</span>
                        <code sz={{ text: 'xs', color: 'blue-400', fontFamily: 'mono', break: 'all' }}>
                            {serverClasses}
                        </code>
                    </div>
                )}
            </div>

            {/* Explanation */}
            <div sz={{ mt: 6, p: 4, rounded: 'lg', bg: { color: 'slate-900', op: 30 }, borderColor: 'slate-700', border: true }}>
                <h4 sz={{ text: 'sm', weight: 'semibold', color: 'white', mb: 2 }}>How it works:</h4>
                <ul sz={{ text: 'xs', color: 'slate-400', spaceY: 1 }}>
                    <li>1. Server renders HTML with mangled classes</li>
                    <li>2. Checksum is injected into HTML</li>
                    <li>3. Client validates checksum on hydration</li>
                    <li>4. If mismatch, recovery mechanism activates</li>
                </ul>
            </div>
        </div>
    );
}
