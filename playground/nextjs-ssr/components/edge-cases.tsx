'use client';

import { useState } from 'react';

export function EdgeCaseTests() {
    const [dynamicValue, setDynamicValue] = useState(4);
    const [isActive, setIsActive] = useState(false);

    return (
        <section sz={{ p: 4, bg: 'slate-900', rounded: 'lg' }}>
            <h2 sz={{ text: '2xl', weight: 'bold', mb: 4, color: 'white' }}>Edge Case Tests</h2>

            {/* Dynamic value control */}
            <div sz={{ mb: 4, display: 'flex', gap: 2 }}>
                <button
                    data-testid="edge-increase"
                    onClick={() => setDynamicValue(v => v + 1)}
                    sz={{ px: 4, py: 2, bg: 'blue-600', color: 'white', rounded: 'md', weight: 'medium' }}
                >
                    Increase ({dynamicValue})
                </button>
                <button
                    data-testid="edge-toggle"
                    onClick={() => setIsActive(!isActive)}
                    sz={{ px: 4, py: 2, bg: 'purple-600', color: 'white', rounded: 'md', weight: 'medium' }}
                >
                    Toggle ({isActive ? 'ON' : 'OFF'})
                </button>
            </div>

            {/* Test grid */}
            <div sz={{ display: 'grid', gridCols: 2, md: { gridCols: 4 }, gap: 4 }}>
                {/* Case 1: Dynamic spacing */}
                <div
                    data-case="1-dynamic-spacing"
                    sz={{ p: dynamicValue, bg: 'blue-500', rounded: 'md', color: 'white', text: 'sm' }}
                >
                    p-{dynamicValue}
                </div>

                {/* Case 2: Arbitrary value */}
                <div
                    data-case="2-arbitrary"
                    sz={{ w: '100px', h: '60px', bg: 'purple-500', rounded: 'md', color: 'white', text: 'sm', display: 'flex', items: 'center', justify: 'center' }}
                >
                    100x60px
                </div>

                {/* Case 3: Dynamic opacity */}
                <div
                    data-case="3-opacity"
                    sz={{ p: 4, bg: { color: 'red-500', op: `${String(dynamicValue * 10)}%` }, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    Opacity {dynamicValue * 10}%
                </div>

                {/* Case 4: Negative value */}
                <div
                    data-case="4-negative"
                    sz={{ mt: -2, p: 4, bg: 'green-500', rounded: 'md', color: 'white', text: 'sm' }}
                >
                    -mt-2
                </div>

                {/* Case 5: Fraction */}
                <div
                    data-case="5-fraction"
                    sz={{ w: '1/2', p: 4, bg: 'yellow-500', rounded: 'md', color: 'black', text: 'sm' }}
                >
                    w-1/2
                </div>

                {/* Case 6: Responsive */}
                <div
                    data-case="6-responsive"
                    sz={{ p: 2, bg: 'gray-500', md: { p: 4, bg: 'blue-500' }, lg: { p: 6, bg: 'green-500' }, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    Responsive
                </div>

                {/* Case 7: Hover */}
                <div
                    data-case="7-hover"
                    sz={{ p: 4, bg: 'gray-500', hover: { bg: 'gray-700', scale: 105 }, transition: 'all', rounded: 'md', cursor: 'pointer', color: 'white', text: 'sm' }}
                >
                    Hover me
                </div>

                {/* Case 8: Conditional */}
                <div
                    data-case="8-conditional"
                    sz={isActive
                        ? { p: 4, bg: 'green-500', rounded: 'md', color: 'white', text: 'sm' }
                        : { p: 4, bg: 'red-500', rounded: 'md', color: 'white', text: 'sm' }
                    }
                >
                    {isActive ? 'Active' : 'Inactive'}
                </div>
            </div>

            {/* Background Image / Gradient cases */}
            <h3 sz={{ text: 'lg', weight: 'semibold', mt: 6, mb: 3, color: 'white' }}>Background Image Tests</h3>
            <div sz={{ display: 'grid', gridCols: 2, md: { gridCols: 4 }, gap: 4 }}>
                {/* Case 9: Linear gradient to-r (object syntax per spec) */}
                <div
                    data-case="9-gradient-r"
                    sz={{ bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'blue-500', to: 'purple-500', p: 4, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-linear-to-r
                </div>

                {/* Case 10: Linear gradient to-b */}
                <div
                    data-case="10-gradient-b"
                    sz={{ bgImg: { gradient: 'linear', dir: 'to-b' }, from: 'green-400', to: 'blue-500', p: 4, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-linear-to-b
                </div>

                {/* Case 11: Gradient with via color stop */}
                <div
                    data-case="11-gradient-via"
                    sz={{ bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'red-500', via: 'yellow-500', to: 'green-500', p: 4, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    gradient via
                </div>

                {/* Case 12: Radial gradient */}
                <div
                    data-case="12-radial"
                    sz={{ bgImg: { gradient: 'radial' }, from: 'white', to: 'blue-500', p: 4, rounded: 'md', color: 'black', text: 'sm' }}
                >
                    bg-radial
                </div>

                {/* Case 13: Conic gradient (no dir → bg-conic) */}
                {/* Note: fromPos: 0 required to work around TW v4 @property bug —
                    --tw-gradient-from-position initial-value: 0 types as 0px (length),
                    but conic gradients need angle|percentage for stop positions */}
                <div
                    data-case="13-conic"
                    sz={{ bgImg: { gradient: 'conic' }, from: 'red-500', fromPos: 0, via: 'blue-500', to: 'green-500', p: 4, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-conic
                </div>

                {/* Case 13b: Conic gradient with position */}
                <div
                    data-case="13b-conic-pos"
                    sz={{ bgImg: { gradient: 'conic', dir: 'at 50% 75%' }, from: 'yellow-400', fromPos: 0, via: 'pink-500', to: 'indigo-500', p: 4, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-conic at 50% 75%
                </div>

                {/* Case 14: Linear gradient with interpolation */}
                <div
                    data-case="14-gradient-interp"
                    sz={{ bgImg: { gradient: 'linear', dir: 'to-r', in: 'oklch' }, from: 'blue-500', to: 'red-500', p: 4, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-linear/oklch
                </div>

                {/* Case 15: bgSize + bgPos + bgRepeat (with gradient to show effect) */}
                <div
                    data-case="15-bg-props"
                    sz={{ bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'cyan-400', to: 'blue-500', bgSize: 'cover', bgPos: 'center', bgRepeat: 'no-repeat', p: 4, rounded: 'md', color: 'white', text: 'sm', h: 16 }}
                >
                    bg-cover + gradient
                </div>

                {/* Case 16: bgClip text + gradient */}
                <div
                    data-case="16-bg-clip"
                    sz={{ bgClip: 'text', bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'pink-500', to: 'violet-500', text: '2xl', weight: 'bold', color: 'transparent', p: 4 }}
                >
                    bg-clip-text
                </div>

                {/* Case 17: bgAttachment (with gradient to show effect) */}
                <div
                    data-case="17-bg-attach"
                    sz={{ bgAttach: 'fixed', bgImg: { gradient: 'linear', dir: 'to-b' }, from: 'indigo-600', to: 'purple-600', p: 4, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-fixed + gradient
                </div>

                {/* Case 18: bgImg none — removes gradient, keeps color */}
                <div
                    data-case="18-bg-none"
                    sz={{ bgImg: 'none', p: 4, rounded: 'md', color: 'slate-400', text: 'sm', borderColor: 'slate-600', border: true }}
                >
                    bg-none (no bg)
                </div>

                {/* Case 19: w-1/2 fraction */}
                <div
                    data-case="19-fraction-w"
                    sz={{ w: '1/2', bg: 'amber-500', p: 4, rounded: 'md', color: 'black', text: 'sm' }}
                >
                    w-1/2 (50%)
                </div>

                {/* Case 20: h-1/3 fraction */}
                <div
                    data-case="20-fraction-h"
                    sz={{ h: '1/3', bg: 'teal-500', p: 4, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    h-1/3 (33.3%)
                </div>
            </div>

            {/* CSS Variable Auto-Compile Tests */}
            <h3 sz={{ text: 'lg', weight: 'semibold', mt: 6, mb: 3, color: 'white' }}>CSS Variable Auto-Compile Tests</h3>
            <div sz={{ display: 'grid', gridCols: 2, md: { gridCols: 4 }, gap: 4 }}>
                {/* Case 21: Dynamic spacing */}
                <div
                    data-case="21-css-var-spacing"
                    sz={{ p: dynamicValue, bg: 'indigo-500', rounded: 'md', color: 'white', text: 'sm' }}
                >
                    p-{'{'}dynamic{'}'}={dynamicValue}
                </div>

                {/* Case 22: Mixed static + dynamic */}
                <div
                    data-case="22-mixed-static-dynamic"
                    sz={{ p: dynamicValue, bg: 'blue-500', rounded: 'md', color: 'white', text: 'sm' }}
                >
                    dynamic p + static bg
                </div>

                {/* Case 23: Static color+opacity (object form) */}
                <div
                    data-case="23-color-opacity-object"
                    sz={{ p: 4, bg: { color: 'red-500', op: 40 }, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-red-500/40
                </div>

                {/* Case 24: Different opacity values */}
                <div
                    data-case="24-color-opacity-high"
                    sz={{ p: 4, bg: { color: 'emerald-500', op: 80 }, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-emerald-500/80
                </div>

                {/* Case 25: Responsive opacity override */}
                <div
                    data-case="25-responsive-opacity"
                    sz={{ p: 4, bg: { color: 'blue-500', op: 20 }, md: { bg: { color: 'blue-500', op: 80 } }, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-blue-500/20 md:80
                </div>

                {/* Case 26: CSS variable opacity */}
                <div
                    data-case="26-css-var-opacity"
                    sz={{ p: 4, bg: { color: 'purple-500', op: '--my-alpha' }, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-purple-500/(--my-alpha)
                </div>

                {/* Case 27: will-change transform */}
                <div
                    data-case="27-will-change"
                    sz={{ p: 4, bg: 'pink-500', willChange: 'transform', rounded: 'md', color: 'white', text: 'sm', hover: { scale: 110 }, transition: 'all' }}
                >
                    will-change-transform
                </div>

                {/* Case 28: will-change scroll-position */}
                <div
                    data-case="28-will-change-scroll"
                    sz={{ p: 4, bg: 'amber-600', willChange: 'scroll', rounded: 'md', color: 'white', text: 'sm' }}
                >
                    will-change-scroll-position
                </div>
            </div>

            {/* New Features: Collision fixes + New capabilities */}
            <h3 sz={{ text: 'lg', weight: 'semibold', mt: 6, mb: 3, color: 'white' }}>New Features (Collision Fixes)</h3>
            <div sz={{ display: 'grid', gridCols: 2, md: { gridCols: 4 }, gap: 4 }}>
                {/* Case 29: Text/Leading shorthand merge */}
                <div
                    data-case="29-text-leading"
                    sz={{ text: 'lg', leading: 7, p: 4, bg: 'emerald-600', rounded: 'md', color: 'white' }}
                >
                    text-lg/7
                </div>

                {/* Case 30: Text/Leading with keyword */}
                <div
                    data-case="30-text-leading-keyword"
                    sz={{ text: 'sm', leading: 'tight', p: 4, bg: 'emerald-700', rounded: 'md', color: 'white' }}
                >
                    text-sm/tight
                </div>

                {/* Case 31: Explicit fontWeight (no catch-all) */}
                <div
                    data-case="31-font-weight"
                    sz={{ weight: 'bold', p: 4, bg: 'blue-600', rounded: 'md', color: 'white', text: 'sm' }}
                >
                    weight: bold
                </div>

                {/* Case 32: Explicit fontFamily (no catch-all) */}
                <div
                    data-case="32-font-family"
                    sz={{ fontFamily: 'mono', p: 4, bg: 'blue-700', rounded: 'md', color: 'white', text: 'sm' }}
                >
                    fontFamily: mono
                </div>

                {/* Case 33: Separate text (size) + color */}
                <div
                    data-case="33-text-color-split"
                    sz={{ text: 'xl', color: 'yellow-400', p: 4, bg: 'gray-800', rounded: 'md' }}
                >
                    text=xl + color=yellow
                </div>

                {/* Case 34: Separate border (width) + borderColor */}
                <div
                    data-case="34-border-split"
                    sz={{ border: 4, borderColor: 'red-500', p: 4, bg: 'gray-800', rounded: 'md', color: 'white', text: 'sm' }}
                >
                    border=4 + borderColor=red
                </div>

                {/* Case 35: insetShadowColor with opacity object */}
                <div
                    data-case="35-inset-shadow-color"
                    sz={{ p: 4, bg: 'white', rounded: 'md', insetShadow: 'sm', insetShadowColor: { color: 'blue-500', op: 40 }, color: 'gray-800', text: 'sm' }}
                >
                    inset-shadow blue/40
                </div>

                {/* Case 36: shadowColor with opacity */}
                <div
                    data-case="36-shadow-color-opacity"
                    sz={{ p: 4, bg: 'white', rounded: 'md', shadow: 'lg', shadowColor: { color: 'purple-500', op: 50 }, color: 'gray-800', text: 'sm' }}
                >
                    shadow purple/50
                </div>
            </div>

            {/* CSS Variable Type Hints */}
            <h3 sz={{ text: 'lg', weight: 'semibold', mt: 6, mb: 3, color: 'white' }}>CSS Variable Type Hints</h3>
            <p sz={{ color: 'slate-400', mb: 4, text: 'xs' }}>
                Ambiguous properties (fontFamily, fontWeight, text) get type hints when using CSS variables.
                Unambiguous properties (color, bg) keep the simple syntax.
            </p>
            <style>{`
                :root {
                    --demo-font: 'Georgia', serif;
                    --demo-weight: 700;
                    --demo-size: 1.25rem;
                    --demo-color: #60a5fa;
                    --demo-bg: #1e293b;
                    --demo-spacing: 1.5rem;
                    --demo-shadow-color: #a855f7;
                    --demo-shadow: 2px 2px 4px green;
                    --demo-inset-shadow: 2px 2px 4px red;
                    --demo-inset-shadow-color: #22d3ee;
                }
            `}</style>
            <div sz={{ display: 'grid', gridCols: 2, md: { gridCols: 3 }, gap: 4 }}>
                {/* Case 37: fontFamily with CSS variable → font-(family-name:--var) */}
                <div
                    data-case="37-css-var-font-family"
                    sz={{ fontFamily: '--demo-font', p: 4, bg: 'slate-800', rounded: 'md', color: 'white', text: 'sm' }}
                >
                    fontFamily: --demo-font<br />
                    <span sz={{ color: 'cyan-400', text: 'xs' }}>→ font-(family-name:--demo-font)</span>
                </div>

                {/* Case 38: fontWeight with CSS variable → font-(weight:--var) */}
                <div
                    data-case="38-css-var-font-weight"
                    sz={{ weight: '--demo-weight', p: 4, bg: 'slate-800', rounded: 'md', color: 'white', text: 'sm' }}
                >
                    weight: --demo-weight<br />
                    <span sz={{ color: 'cyan-400', text: 'xs' }}>→ font-(weight:--demo-weight)</span>
                </div>

                {/* Case 39: text (font-size) with CSS variable → text-(length:--var) */}
                <div
                    data-case="39-css-var-text-size"
                    sz={{ text: '--demo-size', p: 4, bg: 'slate-800', rounded: 'md', color: 'white' }}
                >
                    text: --demo-size<br />
                    <span sz={{ color: 'cyan-400', text: 'xs' }}>→ text-(length:--demo-size)</span>
                </div>

                {/* Case 40: color with CSS variable → text-(--var) (NO type hint) */}
                <div
                    data-case="40-css-var-color"
                    sz={{ color: '--demo-color', p: 4, bg: 'slate-800', rounded: 'md', text: 'sm' }}
                >
                    color: --demo-color<br />
                    <span sz={{ text: 'xs', opacity: 70 }}>→ text-(--demo-color) [no hint]</span>
                </div>

                {/* Case 41: bg with CSS variable → bg-(--var) (NO type hint) */}
                <div
                    data-case="41-css-var-bg"
                    sz={{ bg: '--demo-bg', p: 4, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg: --demo-bg<br />
                    <span sz={{ color: 'cyan-400', text: 'xs' }}>→ bg-(--demo-bg) [no hint]</span>
                </div>

                {/* Case 42: shadowColor with CSS variable → shadow-(color:--var) */}
                <div
                    data-case="42-css-var-shadow-color"
                    sz={{ shadow: 'lg', shadowColor: '--demo-shadow-color', p: 4, bg: 'white', rounded: 'md', color: 'gray-800', text: 'sm' }}
                >
                    shadowColor: --var<br />
                    <span sz={{ color: 'purple-500', text: 'xs' }}>→ shadow-(color:--demo-shadow-color)</span>
                </div>

                {/* Case 42b: shadow (size) with CSS variable → shadow-(--var) — compare with 42 shadowColor */}
                <div
                    data-case="42b-css-var-shadow"
                    sz={{ shadow: '--demo-shadow', p: 4, bg: 'white', rounded: 'md', color: 'gray-800', text: 'sm' }}
                >
                    shadow: --var<br />
                    <span sz={{ color: 'purple-400', text: 'xs' }}>→ shadow-(--demo-shadow) [no color: hint]</span>
                </div>

                {/* Case 43: insetShadowColor with CSS variable → inset-shadow-(color:--var) */}
                <div
                    data-case="43-css-var-inset-shadow"
                    sz={{ insetShadow: 'sm', insetShadowColor: '--demo-inset-shadow-color', p: 4, bg: 'white', rounded: 'md', color: 'gray-800', text: 'sm' }}
                >
                    insetShadowColor: --var<br />
                    <span sz={{ color: 'cyan-500', text: 'xs' }}>→ inset-shadow-(color:--demo-inset-shadow-color)</span>
                </div>

                {/* Case 43b: insetShadow (size) with CSS variable → inset-shadow-(--var) — compare with 43 insetShadowColor */}
                <div
                    data-case="43b-css-var-inset-shadow-size"
                    sz={{ insetShadow: '--demo-inset-shadow', p: 4, bg: 'white', rounded: 'md', color: 'gray-800', text: 'sm' }}
                >
                    insetShadow: --var<br />
                    <span sz={{ color: 'cyan-400', text: 'xs' }}>→ inset-shadow-(--demo-inset-shadow) [no color: hint]</span>
                </div>

                {/* Case 44: text/leading shorthand with CSS variable text size */}
                <div
                    data-case="44-css-var-text-leading"
                    sz={{ text: 'lg', leading: '--demo-spacing', p: 4, bg: 'slate-800', rounded: 'md', color: 'white' }}
                >
                    text: lg + leading: --var<br />
                    <span sz={{ color: 'emerald-400', text: 'xs' }}>Shorthand with CSS var leading</span>
                </div>

                {/* Case 45: Multiple CSS vars in one element */}
                <div
                    data-case="45-multi-css-var"
                    sz={{ fontFamily: '--demo-font', weight: '--demo-weight', text: '--demo-size', color: '--demo-color', p: 4, bg: 'slate-800', rounded: 'md' }}
                >
                    All CSS vars combined<br />
                    <span sz={{ text: 'xs', opacity: 70 }}>font + weight + size + color</span>
                </div>
            </div>
        </section>
    );
}
