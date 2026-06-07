import { describe, expect, it } from 'vitest';

import { parseClass } from '../src/migrate/class-parser.js';

describe('class-parser', () => {
    // ========================================================================
    // BOOLEAN CLASSES
    // ========================================================================
    describe('boolean classes', () => {
        it('display booleans', () => {
            expect(parseClass('block')).toEqual({ prop: 'block', value: true });
            expect(parseClass('flex')).toEqual({ prop: 'flex', value: true });
            expect(parseClass('grid')).toEqual({ prop: 'grid', value: true });
            expect(parseClass('hidden')).toEqual({ prop: 'hidden', value: true });
            expect(parseClass('inline')).toEqual({ prop: 'inline', value: true });
            expect(parseClass('inline-block')).toEqual({ prop: 'inlineBlock', value: true });
            expect(parseClass('inline-flex')).toEqual({ prop: 'inlineFlex', value: true });
            expect(parseClass('inline-grid')).toEqual({ prop: 'inlineGrid', value: true });
            expect(parseClass('contents')).toEqual({ prop: 'contents', value: true });
            expect(parseClass('table')).toEqual({ prop: 'table', value: true });
            expect(parseClass('table-row')).toEqual({ prop: 'tableRow', value: true });
            expect(parseClass('table-cell')).toEqual({ prop: 'tableCell', value: true });
            expect(parseClass('flow-root')).toEqual({ prop: 'flowRoot', value: true });
            expect(parseClass('list-item')).toEqual({ prop: 'listItem', value: true });
        });

        it('transition and group/peer markers', () => {
            // Bare `transition` round-trips through the compiler as boolean sugar,
            // and the prefixed form still resolves to a value, not a no-op.
            expect(parseClass('transition')).toEqual({ prop: 'transition', value: true });
            expect(parseClass('transition-colors')).toEqual({
                prop: 'transition',
                value: 'colors',
            });
            expect(parseClass('group')).toEqual({ prop: 'group', value: true });
            expect(parseClass('peer')).toEqual({ prop: 'peer', value: true });
        });

        it('canonical display mode', () => {
            expect(parseClass('block', { display: 'canonical' })).toEqual({
                prop: 'display',
                value: 'block',
                cssProperty: 'display',
            });
            expect(parseClass('inline-flex', { display: 'canonical' })).toEqual({
                prop: 'display',
                value: 'inline-flex',
                cssProperty: 'display',
            });
            expect(parseClass('hidden', { display: 'canonical' })).toEqual({
                prop: 'display',
                value: 'none',
                cssProperty: 'display',
            });
        });

        it('position booleans', () => {
            expect(parseClass('static')).toEqual({ prop: 'static', value: true });
            expect(parseClass('fixed')).toEqual({ prop: 'fixed', value: true });
            expect(parseClass('absolute')).toEqual({ prop: 'absolute', value: true });
            expect(parseClass('relative')).toEqual({ prop: 'relative', value: true });
            expect(parseClass('sticky')).toEqual({ prop: 'sticky', value: true });
        });

        it('visibility booleans', () => {
            expect(parseClass('visible')).toEqual({ prop: 'visible', value: true });
            expect(parseClass('invisible')).toEqual({ prop: 'invisible', value: true });
            expect(parseClass('collapse')).toEqual({ prop: 'collapse', value: true });
        });

        it('typography booleans', () => {
            expect(parseClass('truncate')).toEqual({ prop: 'truncate', value: true });
            expect(parseClass('uppercase')).toEqual({ prop: 'uppercase', value: true });
            expect(parseClass('lowercase')).toEqual({ prop: 'lowercase', value: true });
            expect(parseClass('capitalize')).toEqual({ prop: 'capitalize', value: true });
            expect(parseClass('normal-case')).toEqual({ prop: 'normalCase', value: true });
            expect(parseClass('underline')).toEqual({ prop: 'underline', value: true });
            expect(parseClass('overline')).toEqual({ prop: 'overline', value: true });
            expect(parseClass('line-through')).toEqual({ prop: 'lineThrough', value: true });
            expect(parseClass('no-underline')).toEqual({ prop: 'noUnderline', value: true });
            expect(parseClass('italic')).toEqual({ prop: 'italic', value: true });
            expect(parseClass('not-italic')).toEqual({ prop: 'notItalic', value: true });
            expect(parseClass('antialiased')).toEqual({ prop: 'antialiased', value: true });
            expect(parseClass('subpixel-antialiased')).toEqual({
                prop: 'subpixelAntialiased',
                value: true,
            });
        });

        it('flexbox booleans', () => {
            expect(parseClass('flex-wrap')).toEqual({ prop: 'flexWrap', value: 'wrap' });
            expect(parseClass('flex-wrap-reverse')).toEqual({
                prop: 'flexWrap',
                value: 'wrap-reverse',
            });
            expect(parseClass('flex-nowrap')).toEqual({ prop: 'flexWrap', value: 'nowrap' });
        });

        it('misc booleans', () => {
            expect(parseClass('container')).toEqual({ prop: 'container', value: true });
            expect(parseClass('sr-only')).toEqual({ prop: 'srOnly', value: true });
            expect(parseClass('not-sr-only')).toEqual({ prop: 'notSrOnly', value: true });
            expect(parseClass('isolate')).toEqual({ prop: 'isolate', value: true });
        });

        it('transform booleans', () => {
            expect(parseClass('transform-gpu')).toEqual({ prop: 'transform', value: 'gpu' });
            expect(parseClass('transform-cpu')).toEqual({ prop: 'transform', value: 'cpu' });
            expect(parseClass('transform-none')).toEqual({ prop: 'transform', value: 'none' });
        });

        it('snap booleans', () => {
            expect(parseClass('snap-x')).toEqual({ prop: 'snapType', value: 'x' });
            expect(parseClass('snap-y')).toEqual({ prop: 'snapType', value: 'y' });
            expect(parseClass('snap-both')).toEqual({ prop: 'snapType', value: 'both' });
            expect(parseClass('snap-none')).toEqual({ prop: 'snapType', value: 'none' });
            expect(parseClass('snap-mandatory')).toEqual({
                prop: 'snapStrictness',
                value: 'mandatory',
            });
            expect(parseClass('snap-proximity')).toEqual({
                prop: 'snapStrictness',
                value: 'proximity',
            });
            expect(parseClass('snap-start')).toEqual({ prop: 'snapAlign', value: 'start' });
            expect(parseClass('snap-end')).toEqual({ prop: 'snapAlign', value: 'end' });
            expect(parseClass('snap-center')).toEqual({ prop: 'snapAlign', value: 'center' });
        });

        it('divide style booleans', () => {
            expect(parseClass('divide-solid')).toEqual({ prop: 'divideStyle', value: 'solid' });
            expect(parseClass('divide-dashed')).toEqual({ prop: 'divideStyle', value: 'dashed' });
        });

        it('font variant booleans', () => {
            expect(parseClass('ordinal')).toEqual({ prop: 'ordinal', value: true });
            expect(parseClass('slashed-zero')).toEqual({ prop: 'slashedZero', value: true });
            expect(parseClass('tabular-nums')).toEqual({
                prop: 'fontVariant',
                value: 'tabular-nums',
            });
            expect(parseClass('lining-nums')).toEqual({
                prop: 'fontVariant',
                value: 'lining-nums',
            });
        });
    });

    // ========================================================================
    // SPACING (p, m, gap, w, h, etc.)
    // ========================================================================
    describe('spacing', () => {
        it('padding', () => {
            expect(parseClass('p-4')).toEqual({ prop: 'p', value: 4 });
            expect(parseClass('p-0')).toEqual({ prop: 'p', value: 0 });
            expect(parseClass('p-0.5')).toEqual({ prop: 'p', value: 0.5 });
            expect(parseClass('p-px')).toEqual({ prop: 'p', value: 'px' });
            expect(parseClass('pt-4')).toEqual({ prop: 'pt', value: 4 });
            expect(parseClass('pr-2')).toEqual({ prop: 'pr', value: 2 });
            expect(parseClass('pb-8')).toEqual({ prop: 'pb', value: 8 });
            expect(parseClass('pl-1')).toEqual({ prop: 'pl', value: 1 });
            expect(parseClass('px-6')).toEqual({ prop: 'px', value: 6 });
            expect(parseClass('py-3')).toEqual({ prop: 'py', value: 3 });
        });

        it('margin', () => {
            expect(parseClass('m-4')).toEqual({ prop: 'm', value: 4 });
            expect(parseClass('m-auto')).toEqual({ prop: 'm', value: 'auto' });
            expect(parseClass('mt-2')).toEqual({ prop: 'mt', value: 2 });
            expect(parseClass('mx-auto')).toEqual({ prop: 'mx', value: 'auto' });
        });

        it('negative margin', () => {
            expect(parseClass('-mt-4')).toEqual({ prop: 'mt', value: -4 });
            expect(parseClass('-ml-2')).toEqual({ prop: 'ml', value: -2 });
            expect(parseClass('-m-1')).toEqual({ prop: 'm', value: -1 });
        });

        it('gap', () => {
            expect(parseClass('gap-4')).toEqual({ prop: 'gap', value: 4 });
            expect(parseClass('gap-x-2')).toEqual({ prop: 'gapX', value: 2 });
            expect(parseClass('gap-y-8')).toEqual({ prop: 'gapY', value: 8 });
        });

        it('space between', () => {
            expect(parseClass('space-x-4')).toEqual({ prop: 'spaceX', value: 4 });
            expect(parseClass('space-y-2')).toEqual({ prop: 'spaceY', value: 2 });
            expect(parseClass('-space-x-4')).toEqual({ prop: 'spaceX', value: -4 });
        });
    });

    // ========================================================================
    // SIZING
    // ========================================================================
    describe('sizing', () => {
        it('width', () => {
            expect(parseClass('w-4')).toEqual({ prop: 'w', value: 4 });
            expect(parseClass('w-full')).toEqual({ prop: 'w', value: 'full' });
            expect(parseClass('w-screen')).toEqual({ prop: 'w', value: 'screen' });
            expect(parseClass('w-auto')).toEqual({ prop: 'w', value: 'auto' });
            expect(parseClass('w-1/2')).toEqual({ prop: 'w', value: '1/2' });
            expect(parseClass('w-2/3')).toEqual({ prop: 'w', value: '2/3' });
        });

        it('height', () => {
            expect(parseClass('h-16')).toEqual({ prop: 'h', value: 16 });
            expect(parseClass('h-full')).toEqual({ prop: 'h', value: 'full' });
            expect(parseClass('h-screen')).toEqual({ prop: 'h', value: 'screen' });
        });

        it('min/max', () => {
            expect(parseClass('min-w-0')).toEqual({ prop: 'minW', value: 0 });
            expect(parseClass('max-w-lg')).toEqual({ prop: 'maxW', value: 'lg' });
            expect(parseClass('min-h-screen')).toEqual({ prop: 'minH', value: 'screen' });
            expect(parseClass('max-h-full')).toEqual({ prop: 'maxH', value: 'full' });
        });

        it('size', () => {
            expect(parseClass('size-4')).toEqual({ prop: 'size', value: 4 });
            expect(parseClass('size-full')).toEqual({ prop: 'size', value: 'full' });
        });
    });

    // ========================================================================
    // TYPOGRAPHY
    // ========================================================================
    describe('typography', () => {
        it('text size (disambiguated from text color)', () => {
            expect(parseClass('text-xs')).toEqual({ prop: 'text', value: 'xs' });
            expect(parseClass('text-sm')).toEqual({ prop: 'text', value: 'sm' });
            expect(parseClass('text-base')).toEqual({ prop: 'text', value: 'base' });
            expect(parseClass('text-lg')).toEqual({ prop: 'text', value: 'lg' });
            expect(parseClass('text-xl')).toEqual({ prop: 'text', value: 'xl' });
            expect(parseClass('text-2xl')).toEqual({ prop: 'text', value: '2xl' });
            expect(parseClass('text-9xl')).toEqual({ prop: 'text', value: '9xl' });
        });

        it('text align', () => {
            expect(parseClass('text-left')).toEqual({ prop: 'textAlign', value: 'left' });
            expect(parseClass('text-center')).toEqual({ prop: 'textAlign', value: 'center' });
            expect(parseClass('text-right')).toEqual({ prop: 'textAlign', value: 'right' });
            expect(parseClass('text-justify')).toEqual({ prop: 'textAlign', value: 'justify' });
        });

        it('text wrap', () => {
            expect(parseClass('text-wrap')).toEqual({ prop: 'textWrap', value: 'wrap' });
            expect(parseClass('text-nowrap')).toEqual({ prop: 'textWrap', value: 'nowrap' });
            expect(parseClass('text-balance')).toEqual({ prop: 'textWrap', value: 'balance' });
            expect(parseClass('text-pretty')).toEqual({ prop: 'textWrap', value: 'pretty' });
        });

        it('text overflow', () => {
            expect(parseClass('text-ellipsis')).toEqual({
                prop: 'textOverflow',
                value: 'ellipsis',
            });
            expect(parseClass('text-clip')).toEqual({ prop: 'textOverflow', value: 'clip' });
        });

        it('word break (break-*)', () => {
            expect(parseClass('break-normal')).toEqual({ prop: 'break', value: 'normal' });
            expect(parseClass('break-all')).toEqual({ prop: 'break', value: 'all' });
            expect(parseClass('break-keep')).toEqual({ prop: 'break', value: 'keep' });
            // break-words migrates to wrap (overflow-wrap) in v4.1
            expect(parseClass('break-words')).toEqual({ prop: 'wrap', value: 'break-word' });
        });

        it('overflow wrap (wrap-*)', () => {
            expect(parseClass('wrap-normal')).toEqual({ prop: 'wrap', value: 'normal' });
            expect(parseClass('wrap-break-word')).toEqual({ prop: 'wrap', value: 'break-word' });
            expect(parseClass('wrap-anywhere')).toEqual({ prop: 'wrap', value: 'anywhere' });
        });

        it('text color (default for text-*)', () => {
            expect(parseClass('text-red-500')).toEqual({ prop: 'color', value: 'red-500' });
            expect(parseClass('text-blue-600')).toEqual({ prop: 'color', value: 'blue-600' });
            expect(parseClass('text-white')).toEqual({ prop: 'color', value: 'white' });
            expect(parseClass('text-black')).toEqual({ prop: 'color', value: 'black' });
            expect(parseClass('text-transparent')).toEqual({ prop: 'color', value: 'transparent' });
        });

        it('font weight', () => {
            expect(parseClass('font-bold')).toEqual({ prop: 'fontWeight', value: 'bold' });
            expect(parseClass('font-semibold')).toEqual({ prop: 'fontWeight', value: 'semibold' });
            expect(parseClass('font-thin')).toEqual({ prop: 'fontWeight', value: 'thin' });
            expect(parseClass('font-normal')).toEqual({ prop: 'fontWeight', value: 'normal' });
            expect(parseClass('font-medium')).toEqual({ prop: 'fontWeight', value: 'medium' });
        });

        it('font weight numeric', () => {
            expect(parseClass('font-100')).toEqual({ prop: 'fontWeight', value: 100 });
            expect(parseClass('font-400')).toEqual({ prop: 'fontWeight', value: 400 });
            expect(parseClass('font-700')).toEqual({ prop: 'fontWeight', value: 700 });
            expect(parseClass('font-900')).toEqual({ prop: 'fontWeight', value: 900 });
        });

        it('font family', () => {
            expect(parseClass('font-sans')).toEqual({ prop: 'fontFamily', value: 'sans' });
            expect(parseClass('font-serif')).toEqual({ prop: 'fontFamily', value: 'serif' });
            expect(parseClass('font-mono')).toEqual({ prop: 'fontFamily', value: 'mono' });
        });

        it('font stretch', () => {
            expect(parseClass('font-stretch-50%')).toEqual({ prop: 'fontStretch', value: '50%' });
            expect(parseClass('font-condensed')).toEqual({
                prop: 'fontStretch',
                value: 'condensed',
            });
        });

        it('leading (line-height)', () => {
            expect(parseClass('leading-6')).toEqual({ prop: 'leading', value: 6 });
            expect(parseClass('leading-tight')).toEqual({ prop: 'leading', value: 'tight' });
            expect(parseClass('leading-none')).toEqual({ prop: 'leading', value: 'none' });
        });

        it('tracking (letter-spacing)', () => {
            expect(parseClass('tracking-tight')).toEqual({ prop: 'tracking', value: 'tight' });
            expect(parseClass('tracking-wide')).toEqual({ prop: 'tracking', value: 'wide' });
            expect(parseClass('-tracking-2')).toEqual({ prop: 'tracking', value: -2 });
        });

        it('indent', () => {
            expect(parseClass('indent-4')).toEqual({ prop: 'indent', value: 4 });
            expect(parseClass('-indent-4')).toEqual({ prop: 'indent', value: -4 });
        });

        it('content — both quote forms normalize to double-quote (round-trip stability)', () => {
            // content-[''] and content-[""] must both produce { content: '""' } so that
            // the compiler can reliably re-generate content-[''] on the next forward pass.
            expect(parseClass("content-['']")).toEqual({ prop: 'content', value: '""' });
            expect(parseClass('content-[""]')).toEqual({ prop: 'content', value: '""' });
            expect(parseClass("content-['hello']")).toEqual({ prop: 'content', value: '"hello"' });
            expect(parseClass('content-["hello"]')).toEqual({ prop: 'content', value: '"hello"' });
            expect(parseClass('content-none')).toEqual({ prop: 'content', value: 'none' });
        });
    });

    // ========================================================================
    // BACKGROUNDS
    // ========================================================================
    describe('backgrounds', () => {
        it('bg color (default for bg-*)', () => {
            expect(parseClass('bg-blue-500')).toEqual({ prop: 'bg', value: 'blue-500' });
            expect(parseClass('bg-white')).toEqual({ prop: 'bg', value: 'white' });
            expect(parseClass('bg-red-600')).toEqual({ prop: 'bg', value: 'red-600' });
        });

        it('bg position', () => {
            expect(parseClass('bg-center')).toEqual({ prop: 'bgPos', value: 'center' });
            expect(parseClass('bg-top')).toEqual({ prop: 'bgPos', value: 'top' });
            expect(parseClass('bg-bottom')).toEqual({ prop: 'bgPos', value: 'bottom' });
        });

        it('bg size', () => {
            expect(parseClass('bg-cover')).toEqual({ prop: 'bgSize', value: 'cover' });
            expect(parseClass('bg-contain')).toEqual({ prop: 'bgSize', value: 'contain' });
            expect(parseClass('bg-auto')).toEqual({ prop: 'bgSize', value: 'auto' });
        });

        it('bg repeat', () => {
            expect(parseClass('bg-repeat')).toEqual({ prop: 'bgRepeat', value: 'repeat' });
            expect(parseClass('bg-no-repeat')).toEqual({ prop: 'bgRepeat', value: 'no-repeat' });
        });

        it('bg attachment', () => {
            expect(parseClass('bg-fixed')).toEqual({ prop: 'bgAttach', value: 'fixed' });
            expect(parseClass('bg-local')).toEqual({ prop: 'bgAttach', value: 'local' });
            expect(parseClass('bg-scroll')).toEqual({ prop: 'bgAttach', value: 'scroll' });
        });

        it('bg clip', () => {
            expect(parseClass('bg-clip-text')).toEqual({ prop: 'bgClip', value: 'text' });
            expect(parseClass('bg-clip-border')).toEqual({ prop: 'bgClip', value: 'border' });
            expect(parseClass('bg-clip-padding')).toEqual({ prop: 'bgClip', value: 'padding' });
            expect(parseClass('bg-clip-content')).toEqual({ prop: 'bgClip', value: 'content' });
        });

        it('bg origin', () => {
            expect(parseClass('bg-origin-border')).toEqual({ prop: 'bgOrigin', value: 'border' });
            expect(parseClass('bg-origin-padding')).toEqual({ prop: 'bgOrigin', value: 'padding' });
            expect(parseClass('bg-origin-content')).toEqual({ prop: 'bgOrigin', value: 'content' });
        });
    });

    // ========================================================================
    // GRADIENTS
    // ========================================================================
    describe('gradients', () => {
        it('linear gradient directions', () => {
            expect(parseClass('bg-linear-to-r')).toEqual({
                prop: 'bgImg',
                value: { gradient: 'linear', dir: 'to-r' },
            });
            expect(parseClass('bg-linear-to-br')).toEqual({
                prop: 'bgImg',
                value: { gradient: 'linear', dir: 'to-br' },
            });
        });

        it('linear gradient numeric angle', () => {
            expect(parseClass('bg-linear-45')).toEqual({
                prop: 'bgImg',
                value: { gradient: 'linear', dir: 45 },
            });
        });

        it('negative linear gradient angle', () => {
            expect(parseClass('-bg-linear-30')).toEqual({
                prop: 'bgImg',
                value: { gradient: 'linear', dir: -30 },
            });
        });

        it('radial gradient', () => {
            expect(parseClass('bg-radial')).toEqual({
                prop: 'bgImg',
                value: { gradient: 'radial' },
            });
        });

        it('radial gradient with arbitrary direction', () => {
            expect(parseClass('bg-radial-[at_50%_75%]')).toEqual({
                prop: 'bgImg',
                value: { gradient: 'radial', dir: 'at 50% 75%' },
            });
        });

        it('conic gradient', () => {
            expect(parseClass('bg-conic')).toEqual({
                prop: 'bgImg',
                value: { gradient: 'conic' },
            });
            expect(parseClass('bg-conic-90')).toEqual({
                prop: 'bgImg',
                value: { gradient: 'conic', dir: 90 },
            });
        });

        it('gradient with color interpolation', () => {
            expect(parseClass('bg-linear-to-r/hsl')).toEqual({
                prop: 'bgImg',
                value: { gradient: 'linear', dir: 'to-r', in: 'hsl' },
            });
            expect(parseClass('bg-radial/oklab')).toEqual({
                prop: 'bgImg',
                value: { gradient: 'radial', in: 'oklab' },
            });
        });

        it('gradient stops', () => {
            expect(parseClass('from-blue-500')).toEqual({ prop: 'from', value: 'blue-500' });
            expect(parseClass('via-green-400')).toEqual({ prop: 'via', value: 'green-400' });
            expect(parseClass('to-red-600')).toEqual({ prop: 'to', value: 'red-600' });
        });
    });

    // ========================================================================
    // BORDERS
    // ========================================================================
    describe('borders', () => {
        it('border width', () => {
            expect(parseClass('border-0')).toEqual({ prop: 'border', value: 0 });
            expect(parseClass('border-2')).toEqual({ prop: 'border', value: 2 });
            expect(parseClass('border-4')).toEqual({ prop: 'border', value: 4 });
            expect(parseClass('border-8')).toEqual({ prop: 'border', value: 8 });
        });

        it('border arbitrary width (not color)', () => {
            // Arbitrary dimensions → border width, NOT borderColor
            expect(parseClass('border-[1.5px]')).toEqual({ prop: 'border', value: '1.5px' });
            expect(parseClass('border-[3px]')).toEqual({ prop: 'border', value: '3px' });
            expect(parseClass('border-[0.5rem]')).toEqual({ prop: 'border', value: '0.5rem' });
            // Arbitrary colors still → borderColor
            expect(parseClass('border-[#50d71e]')).toEqual({
                prop: 'borderColor',
                value: '#50d71e',
            });
        });

        it('border style', () => {
            expect(parseClass('border-solid')).toEqual({ prop: 'borderStyle', value: 'solid' });
            expect(parseClass('border-dashed')).toEqual({ prop: 'borderStyle', value: 'dashed' });
            expect(parseClass('border-dotted')).toEqual({ prop: 'borderStyle', value: 'dotted' });
            expect(parseClass('border-double')).toEqual({ prop: 'borderStyle', value: 'double' });
            expect(parseClass('border-none')).toEqual({ prop: 'borderStyle', value: 'none' });
        });

        it('border color', () => {
            expect(parseClass('border-red-500')).toEqual({ prop: 'borderColor', value: 'red-500' });
            expect(parseClass('border-gray-200')).toEqual({
                prop: 'borderColor',
                value: 'gray-200',
            });
        });

        it('border sides', () => {
            expect(parseClass('border-t-2')).toEqual({ prop: 'borderT', value: 2 });
            expect(parseClass('border-r-4')).toEqual({ prop: 'borderR', value: 4 });
            expect(parseClass('border-b-0')).toEqual({ prop: 'borderB', value: 0 });
            expect(parseClass('border-l-8')).toEqual({ prop: 'borderL', value: 8 });
        });

        it('border radius', () => {
            expect(parseClass('rounded-lg')).toEqual({ prop: 'rounded', value: 'lg' });
            expect(parseClass('rounded-full')).toEqual({ prop: 'rounded', value: 'full' });
            expect(parseClass('rounded-none')).toEqual({ prop: 'rounded', value: 'none' });
            expect(parseClass('rounded-t-lg')).toEqual({ prop: 'roundedT', value: 'lg' });
            expect(parseClass('rounded-tl-md')).toEqual({ prop: 'roundedTl', value: 'md' });
        });

        it('ring', () => {
            expect(parseClass('ring-2')).toEqual({ prop: 'ring', value: 2 });
            expect(parseClass('ring-blue-500')).toEqual({ prop: 'ringColor', value: 'blue-500' });
            expect(parseClass('ring-offset-2')).toEqual({ prop: 'ringOffset', value: 2 });
        });

        it('ring arbitrary width (not color)', () => {
            // Arbitrary dimensions → ring width, NOT ringColor
            expect(parseClass('ring-[3px]')).toEqual({ prop: 'ring', value: '3px' });
            expect(parseClass('ring-[1.5px]')).toEqual({ prop: 'ring', value: '1.5px' });
            // Arbitrary colors still → ringColor
            expect(parseClass('ring-[#ff0000]')).toEqual({ prop: 'ringColor', value: '#ff0000' });
        });

        it('outline', () => {
            expect(parseClass('outline-2')).toEqual({ prop: 'outline', value: 2 });
            expect(parseClass('outline-dashed')).toEqual({ prop: 'outlineStyle', value: 'dashed' });
            expect(parseClass('outline-blue-500')).toEqual({
                prop: 'outlineColor',
                value: 'blue-500',
            });
            expect(parseClass('outline-offset-2')).toEqual({ prop: 'outlineOffset', value: 2 });
        });

        it('outline arbitrary width (not color)', () => {
            // Arbitrary dimensions → outline width, NOT outlineColor
            expect(parseClass('outline-[3px]')).toEqual({ prop: 'outline', value: '3px' });
        });
    });

    // ========================================================================
    // LAYOUT
    // ========================================================================
    describe('layout', () => {
        it('z-index', () => {
            expect(parseClass('z-10')).toEqual({ prop: 'z', value: 10 });
            expect(parseClass('z-50')).toEqual({ prop: 'z', value: 50 });
            expect(parseClass('-z-10')).toEqual({ prop: 'z', value: -10 });
            expect(parseClass('z-auto')).toEqual({ prop: 'z', value: 'auto' });
        });

        it('inset', () => {
            expect(parseClass('inset-0')).toEqual({ prop: 'inset', value: 0 });
            expect(parseClass('inset-x-4')).toEqual({ prop: 'insetX', value: 4 });
            expect(parseClass('inset-y-0')).toEqual({ prop: 'insetY', value: 0 });
            expect(parseClass('top-0')).toEqual({ prop: 'top', value: 0 });
            expect(parseClass('right-4')).toEqual({ prop: 'right', value: 4 });
            expect(parseClass('bottom-auto')).toEqual({ prop: 'bottom', value: 'auto' });
            expect(parseClass('left-1/2')).toEqual({ prop: 'left', value: '1/2' });
            expect(parseClass('-top-4')).toEqual({ prop: 'top', value: -4 });
        });

        it('overflow', () => {
            expect(parseClass('overflow-hidden')).toEqual({ prop: 'overflow', value: 'hidden' });
            expect(parseClass('overflow-auto')).toEqual({ prop: 'overflow', value: 'auto' });
            expect(parseClass('overflow-x-auto')).toEqual({ prop: 'overflowX', value: 'auto' });
            expect(parseClass('overflow-y-scroll')).toEqual({ prop: 'overflowY', value: 'scroll' });
        });

        it('object fit/position', () => {
            expect(parseClass('object-cover')).toEqual({ prop: 'objectFit', value: 'cover' });
            expect(parseClass('object-contain')).toEqual({ prop: 'objectFit', value: 'contain' });
            expect(parseClass('object-fill')).toEqual({ prop: 'objectFit', value: 'fill' });
            expect(parseClass('object-none')).toEqual({ prop: 'objectFit', value: 'none' });
            expect(parseClass('object-center')).toEqual({ prop: 'objectPos', value: 'center' });
            expect(parseClass('object-top')).toEqual({ prop: 'objectPos', value: 'top' });
        });

        it('aspect ratio', () => {
            expect(parseClass('aspect-square')).toEqual({ prop: 'aspect', value: 'square' });
            expect(parseClass('aspect-video')).toEqual({ prop: 'aspect', value: 'video' });
            expect(parseClass('aspect-auto')).toEqual({ prop: 'aspect', value: 'auto' });
        });

        it('columns', () => {
            expect(parseClass('columns-3')).toEqual({ prop: 'columns', value: 3 });
            expect(parseClass('columns-auto')).toEqual({ prop: 'columns', value: 'auto' });
        });
    });

    // ========================================================================
    // FLEXBOX & GRID
    // ========================================================================
    describe('flexbox & grid', () => {
        it('flex direction', () => {
            expect(parseClass('flex-row')).toEqual({ prop: 'flexDir', value: 'row' });
            expect(parseClass('flex-col')).toEqual({ prop: 'flexDir', value: 'col' });
            expect(parseClass('flex-row-reverse')).toEqual({
                prop: 'flexDir',
                value: 'row-reverse',
            });
            expect(parseClass('flex-col-reverse')).toEqual({
                prop: 'flexDir',
                value: 'col-reverse',
            });
        });

        it('flex shorthand', () => {
            expect(parseClass('flex-1')).toEqual({ prop: 'flex', value: '1' });
            expect(parseClass('flex-auto')).toEqual({ prop: 'flex', value: 'auto' });
            expect(parseClass('flex-initial')).toEqual({ prop: 'flex', value: 'initial' });
            expect(parseClass('flex-none')).toEqual({ prop: 'flex', value: 'none' });
        });

        it('grow/shrink', () => {
            expect(parseClass('grow-0')).toEqual({ prop: 'grow', value: 0 });
            expect(parseClass('shrink-0')).toEqual({ prop: 'shrink', value: 0 });
        });

        it('justify/align', () => {
            expect(parseClass('justify-center')).toEqual({ prop: 'justify', value: 'center' });
            expect(parseClass('justify-between')).toEqual({ prop: 'justify', value: 'between' });
            expect(parseClass('items-center')).toEqual({ prop: 'items', value: 'center' });
            expect(parseClass('items-start')).toEqual({ prop: 'items', value: 'start' });
            expect(parseClass('self-end')).toEqual({ prop: 'self', value: 'end' });
        });

        it('grid template', () => {
            expect(parseClass('grid-cols-3')).toEqual({ prop: 'gridCols', value: 3 });
            expect(parseClass('grid-cols-12')).toEqual({ prop: 'gridCols', value: 12 });
            expect(parseClass('grid-rows-4')).toEqual({ prop: 'gridRows', value: 4 });
        });

        it('grid span/start/end', () => {
            expect(parseClass('col-span-3')).toEqual({ prop: 'colSpan', value: 3 });
            expect(parseClass('col-start-2')).toEqual({ prop: 'colStart', value: 2 });
            expect(parseClass('col-end-4')).toEqual({ prop: 'colEnd', value: 4 });
            expect(parseClass('row-span-2')).toEqual({ prop: 'rowSpan', value: 2 });
        });

        it('grid flow', () => {
            expect(parseClass('grid-flow-row')).toEqual({ prop: 'gridFlow', value: 'row' });
            expect(parseClass('grid-flow-col')).toEqual({ prop: 'gridFlow', value: 'col' });
            expect(parseClass('grid-flow-dense')).toEqual({ prop: 'gridFlow', value: 'dense' });
        });

        it('auto cols/rows', () => {
            expect(parseClass('auto-cols-auto')).toEqual({ prop: 'autoCols', value: 'auto' });
            expect(parseClass('auto-cols-min')).toEqual({ prop: 'autoCols', value: 'min' });
            expect(parseClass('auto-rows-auto')).toEqual({ prop: 'autoRows', value: 'auto' });
        });

        it('place/justify items', () => {
            expect(parseClass('place-content-center')).toEqual({
                prop: 'placeContent',
                value: 'center',
            });
            expect(parseClass('place-items-center')).toEqual({
                prop: 'placeItems',
                value: 'center',
            });
            expect(parseClass('place-self-auto')).toEqual({ prop: 'placeSelf', value: 'auto' });
            expect(parseClass('justify-items-center')).toEqual({
                prop: 'justifyItems',
                value: 'center',
            });
            expect(parseClass('justify-self-end')).toEqual({ prop: 'justifySelf', value: 'end' });
        });

        it('order', () => {
            expect(parseClass('order-1')).toEqual({ prop: 'order', value: 1 });
            expect(parseClass('order-first')).toEqual({ prop: 'order', value: 'first' });
            expect(parseClass('order-last')).toEqual({ prop: 'order', value: 'last' });
            expect(parseClass('-order-1')).toEqual({ prop: 'order', value: -1 });
        });

        it('basis', () => {
            expect(parseClass('basis-1/2')).toEqual({ prop: 'basis', value: '1/2' });
            expect(parseClass('basis-auto')).toEqual({ prop: 'basis', value: 'auto' });
            expect(parseClass('basis-full')).toEqual({ prop: 'basis', value: 'full' });
        });
    });

    // ========================================================================
    // EFFECTS
    // ========================================================================
    describe('effects', () => {
        it('shadow', () => {
            expect(parseClass('shadow-sm')).toEqual({ prop: 'shadow', value: 'sm' });
            expect(parseClass('shadow-md')).toEqual({ prop: 'shadow', value: 'md' });
            expect(parseClass('shadow-lg')).toEqual({ prop: 'shadow', value: 'lg' });
            expect(parseClass('shadow-none')).toEqual({ prop: 'shadow', value: 'none' });
        });

        it('shadow color', () => {
            expect(parseClass('shadow-blue-500')).toEqual({
                prop: 'shadowColor',
                value: 'blue-500',
            });
        });

        it('opacity', () => {
            expect(parseClass('opacity-50')).toEqual({ prop: 'opacity', value: 50 });
            expect(parseClass('opacity-0')).toEqual({ prop: 'opacity', value: 0 });
            expect(parseClass('opacity-100')).toEqual({ prop: 'opacity', value: 100 });
        });
    });

    // ========================================================================
    // FILTERS
    // ========================================================================
    describe('filters', () => {
        it('blur with value', () => {
            expect(parseClass('blur-sm')).toEqual({ prop: 'blur', value: 'sm' });
            expect(parseClass('blur-md')).toEqual({ prop: 'blur', value: 'md' });
        });

        it('brightness/contrast/saturate', () => {
            expect(parseClass('brightness-50')).toEqual({ prop: 'brightness', value: 50 });
            expect(parseClass('contrast-75')).toEqual({ prop: 'contrast', value: 75 });
            expect(parseClass('saturate-150')).toEqual({ prop: 'saturate', value: 150 });
        });

        it('hue-rotate', () => {
            expect(parseClass('hue-rotate-90')).toEqual({ prop: 'hueRotate', value: 90 });
            expect(parseClass('-hue-rotate-15')).toEqual({ prop: 'hueRotate', value: -15 });
        });

        it('backdrop filters', () => {
            expect(parseClass('backdrop-blur-sm')).toEqual({ prop: 'backdropBlur', value: 'sm' });
            expect(parseClass('backdrop-brightness-50')).toEqual({
                prop: 'backdropBrightness',
                value: 50,
            });
        });
    });

    // ========================================================================
    // TRANSFORMS
    // ========================================================================
    describe('transforms', () => {
        it('scale', () => {
            expect(parseClass('scale-50')).toEqual({ prop: 'scale', value: 50 });
            expect(parseClass('scale-100')).toEqual({ prop: 'scale', value: 100 });
            expect(parseClass('scale-x-75')).toEqual({ prop: 'scaleX', value: 75 });
            expect(parseClass('scale-y-125')).toEqual({ prop: 'scaleY', value: 125 });
        });

        it('rotate', () => {
            expect(parseClass('rotate-45')).toEqual({ prop: 'rotate', value: 45 });
            expect(parseClass('rotate-90')).toEqual({ prop: 'rotate', value: 90 });
            expect(parseClass('-rotate-45')).toEqual({ prop: 'rotate', value: -45 });
        });

        it('translate', () => {
            expect(parseClass('translate-x-4')).toEqual({ prop: 'translateX', value: 4 });
            expect(parseClass('translate-y-1/2')).toEqual({ prop: 'translateY', value: '1/2' });
            expect(parseClass('-translate-x-4')).toEqual({ prop: 'translateX', value: -4 });
        });

        it('skew', () => {
            expect(parseClass('skew-x-3')).toEqual({ prop: 'skewX', value: 3 });
            expect(parseClass('skew-y-6')).toEqual({ prop: 'skewY', value: 6 });
            expect(parseClass('-skew-x-3')).toEqual({ prop: 'skewX', value: -3 });
        });

        it('origin', () => {
            expect(parseClass('origin-center')).toEqual({ prop: 'origin', value: 'center' });
            expect(parseClass('origin-top')).toEqual({ prop: 'origin', value: 'top' });
        });
    });

    // ========================================================================
    // TRANSITIONS & ANIMATION
    // ========================================================================
    describe('transitions & animation', () => {
        it('transition', () => {
            expect(parseClass('transition-all')).toEqual({ prop: 'transition', value: 'all' });
            expect(parseClass('transition-colors')).toEqual({
                prop: 'transition',
                value: 'colors',
            });
            expect(parseClass('transition-opacity')).toEqual({
                prop: 'transition',
                value: 'opacity',
            });
            expect(parseClass('transition-none')).toEqual({ prop: 'transition', value: 'none' });
        });

        it('duration', () => {
            expect(parseClass('duration-150')).toEqual({ prop: 'duration', value: 150 });
            expect(parseClass('duration-300')).toEqual({ prop: 'duration', value: 300 });
        });

        it('ease', () => {
            expect(parseClass('ease-in')).toEqual({ prop: 'ease', value: 'in' });
            expect(parseClass('ease-out')).toEqual({ prop: 'ease', value: 'out' });
            expect(parseClass('ease-in-out')).toEqual({ prop: 'ease', value: 'in-out' });
            expect(parseClass('ease-linear')).toEqual({ prop: 'ease', value: 'linear' });
        });

        it('delay', () => {
            expect(parseClass('delay-100')).toEqual({ prop: 'delay', value: 100 });
            expect(parseClass('delay-500')).toEqual({ prop: 'delay', value: 500 });
        });

        it('animate', () => {
            expect(parseClass('animate-spin')).toEqual({ prop: 'animate', value: 'spin' });
            expect(parseClass('animate-ping')).toEqual({ prop: 'animate', value: 'ping' });
            expect(parseClass('animate-bounce')).toEqual({ prop: 'animate', value: 'bounce' });
            expect(parseClass('animate-none')).toEqual({ prop: 'animate', value: 'none' });
        });
    });

    // ========================================================================
    // INTERACTIVITY
    // ========================================================================
    describe('interactivity', () => {
        it('cursor', () => {
            expect(parseClass('cursor-pointer')).toEqual({ prop: 'cursor', value: 'pointer' });
            expect(parseClass('cursor-default')).toEqual({ prop: 'cursor', value: 'default' });
            expect(parseClass('cursor-not-allowed')).toEqual({
                prop: 'cursor',
                value: 'not-allowed',
            });
        });

        it('user select', () => {
            expect(parseClass('select-none')).toEqual({ prop: 'select', value: 'none' });
            expect(parseClass('select-text')).toEqual({ prop: 'select', value: 'text' });
            expect(parseClass('select-all')).toEqual({ prop: 'select', value: 'all' });
        });

        it('scroll margin/padding', () => {
            expect(parseClass('scroll-m-4')).toEqual({ prop: 'scrollM', value: 4 });
            expect(parseClass('scroll-mt-8')).toEqual({ prop: 'scrollMt', value: 8 });
            expect(parseClass('scroll-p-4')).toEqual({ prop: 'scrollP', value: 4 });
        });

        it('pointer events', () => {
            expect(parseClass('pointer-events-none')).toEqual({
                prop: 'pointerEvents',
                value: 'none',
            });
            expect(parseClass('pointer-events-auto')).toEqual({
                prop: 'pointerEvents',
                value: 'auto',
            });
        });

        it('caret', () => {
            expect(parseClass('caret-blue-500')).toEqual({ prop: 'caret', value: 'blue-500' });
        });

        it('accent', () => {
            expect(parseClass('accent-pink-500')).toEqual({ prop: 'accent', value: 'pink-500' });
        });

        it('will-change', () => {
            expect(parseClass('will-change-auto')).toEqual({ prop: 'willChange', value: 'auto' });
            expect(parseClass('will-change-transform')).toEqual({
                prop: 'willChange',
                value: 'transform',
            });
        });
    });

    // ========================================================================
    // SVG
    // ========================================================================
    describe('SVG', () => {
        it('fill', () => {
            expect(parseClass('fill-current')).toEqual({ prop: 'fill', value: 'current' });
            expect(parseClass('fill-blue-500')).toEqual({ prop: 'fill', value: 'blue-500' });
        });

        it('stroke', () => {
            expect(parseClass('stroke-current')).toEqual({ prop: 'stroke', value: 'current' });
            expect(parseClass('stroke-1')).toEqual({ prop: 'strokeWidth', value: 1 });
            expect(parseClass('stroke-2')).toEqual({ prop: 'strokeWidth', value: 2 });
        });
    });

    // ========================================================================
    // ARBITRARY VALUES
    // ========================================================================
    describe('arbitrary values', () => {
        it('arbitrary spacing', () => {
            expect(parseClass('p-[10px]')).toEqual({ prop: 'p', value: '10px' });
            expect(parseClass('m-[2rem]')).toEqual({ prop: 'm', value: '2rem' });
            expect(parseClass('w-[200px]')).toEqual({ prop: 'w', value: '200px' });
        });

        it('arbitrary colors', () => {
            expect(parseClass('text-[#ff0000]')).toEqual({ prop: 'color', value: '#ff0000' });
            expect(parseClass('bg-[#333]')).toEqual({ prop: 'bg', value: '#333' });
        });

        it('text arbitrary size (not color)', () => {
            // Arbitrary CSS dimensions → font size (text prop), NOT color
            expect(parseClass('text-[0.8rem]')).toEqual({ prop: 'text', value: '0.8rem' });
            expect(parseClass('text-[16px]')).toEqual({ prop: 'text', value: '16px' });
            expect(parseClass('text-[1.5em]')).toEqual({ prop: 'text', value: '1.5em' });
            // Arbitrary hex color still → color
            expect(parseClass('text-[#50d71e]')).toEqual({ prop: 'color', value: '#50d71e' });
        });

        it('CSS variable sugar', () => {
            expect(parseClass('p-(--spacing)')).toEqual({ prop: 'p', value: '--spacing' });
            expect(parseClass('bg-(--brand)')).toEqual({ prop: 'bg', value: '--brand' });
        });

        it('CSS custom property declaration', () => {
            expect(parseClass('[--my-var:10px]')).toEqual({ prop: '--my-var', value: '10px' });
        });
    });

    // ========================================================================
    // COLOR + OPACITY
    // ========================================================================
    describe('color + opacity', () => {
        it('color with numeric opacity', () => {
            expect(parseClass('bg-blue-500/50')).toEqual({
                prop: 'bg',
                value: { color: 'blue-500', op: 50 },
            });
            expect(parseClass('text-red-600/75')).toEqual({
                prop: 'color',
                value: { color: 'red-600', op: 75 },
            });
        });

        it('color with arbitrary opacity', () => {
            expect(parseClass('bg-pink-500/[78%]')).toEqual({
                prop: 'bg',
                value: { color: 'pink-500', op: '78%' },
            });
        });

        it('color with CSS variable opacity', () => {
            expect(parseClass('bg-blue-500/(--alpha)')).toEqual({
                prop: 'bg',
                value: { color: 'blue-500', op: '--alpha' },
            });
        });
    });

    // ========================================================================
    // IMPORTANT MODIFIER
    // ========================================================================
    describe('important modifier', () => {
        it('string value with !', () => {
            expect(parseClass('text-red-500!')).toEqual({ prop: 'color', value: 'red-500!' });
        });

        it('boolean with !', () => {
            expect(parseClass('flex!')).toEqual({ prop: 'flex', value: '!' });
        });

        it('numeric with !', () => {
            expect(parseClass('p-4!')).toEqual({ prop: 'p', value: '4!' });
        });
    });

    // ========================================================================
    // TABLES
    // ========================================================================
    describe('tables', () => {
        it('table layout', () => {
            expect(parseClass('table-auto')).toEqual({ prop: 'tableLayout', value: 'auto' });
            expect(parseClass('table-fixed')).toEqual({ prop: 'tableLayout', value: 'fixed' });
        });

        it('border spacing', () => {
            expect(parseClass('border-spacing-2')).toEqual({ prop: 'borderSpacing', value: 2 });
        });

        it('caption', () => {
            expect(parseClass('caption-top')).toEqual({ prop: 'caption', value: 'top' });
            expect(parseClass('caption-bottom')).toEqual({ prop: 'caption', value: 'bottom' });
        });
    });

    // ========================================================================
    // EDGE CASES
    // ========================================================================
    describe('edge cases', () => {
        it('returns null for unrecognized classes', () => {
            expect(parseClass('my-custom-class')).toBeNull();
            expect(parseClass('whatever')).toBeNull();
        });

        it('multi-part prefixes (longest match)', () => {
            // These should match the longer prefix, not shorter
            expect(parseClass('bg-clip-text')).toEqual({ prop: 'bgClip', value: 'text' });
            expect(parseClass('col-span-3')).toEqual({ prop: 'colSpan', value: 3 });
            expect(parseClass('grid-cols-3')).toEqual({ prop: 'gridCols', value: 3 });
            expect(parseClass('place-content-center')).toEqual({
                prop: 'placeContent',
                value: 'center',
            });
            expect(parseClass('underline-offset-4')).toEqual({ prop: 'underlineOffset', value: 4 });
        });

        it('divide with prefix matching', () => {
            expect(parseClass('divide-x-2')).toEqual({ prop: 'divideX', value: 2 });
            expect(parseClass('divide-y-4')).toEqual({ prop: 'divideY', value: 4 });
        });

        it('negative not allowed', () => {
            // -p-4 is invalid (padding can't be negative in TW), should fall through
            // Actually p IS a spacing prop but negative padding doesn't make sense in TW
            // However the parser doesn't enforce this — NEGATIVE_ALLOWED determines it
            // In our reverse map, 'p' is NOT in NEGATIVE_ALLOWED, so -p-4 returns null
            expect(parseClass('-p-4')).toBeNull();
        });
    });
});
