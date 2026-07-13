import { transform } from './src/transform';

console.log('--- VS Code UX Mapping Verification ---');

import type { SzObject } from './src/transform';

const testCases: {
    name: string;
    input: SzObject;
    expected: string;
    expectedAttributes?: Record<string, string>;
}[] = [
    {
        name: 'Canonical Key',
        input: { bg: 'blue-500', p: 4 },
        expected: 'bg-blue-500 p-4',
    },
    {
        name: 'Dual Support (Shorthand)',
        input: { bg: 'blue-500', p: 4 },
        expected: 'bg-blue-500 p-4',
    },
    {
        name: 'Sugar Variable Syntax (--c)',
        input: { border: '--c-primary' },
        expected: 'border-(--c-primary)',
    },
    {
        name: 'Raw Variable Syntax (var(--c))',
        input: { border: 'var(--c-primary)' },
        expected: 'border-(--c-primary)',
    },
    {
        name: 'Implicit v4 Grouping (border)',
        input: { border: '--w-thin' },
        expected: 'border-width-(--w-thin)',
    },
    {
        name: 'Theme-mapped (rounded)',
        input: { rounded: 'lg' },
        expected: 'rounded-lg',
    },
    {
        name: 'Grouped Properties (display)',
        input: { display: 'flex', items: 'center' },
        expected: 'flex items-center',
    },
    {
        name: 'Shorthand Property (m)',
        input: { m: 4 },
        expected: 'm-4',
    },
    {
        name: 'Will Change Extraction',
        input: { willChange: 'transform', opacity: 1 },
        expected: 'opacity-1', // willChange should be removed from class
        expectedAttributes: { 'data-sz-will-change': 'transform' },
    },
];

let failed = 0;

testCases.forEach(tc => {
    const result = transform(tc.input);
    const actual = result.className || '';

    // Check attributes for will-change test
    if (tc.expectedAttributes) {
        const attrMatch =
            JSON.stringify(result.attributes) === JSON.stringify(tc.expectedAttributes);
        if (!attrMatch) {
            console.log(`❌ ${tc.name}: Attributes Mismatch`);
            console.log(`   Expected: ${JSON.stringify(tc.expectedAttributes)}`);
            console.log(`   Actual:   ${JSON.stringify(result.attributes)}`);
            failed++;
            return;
        }
    }
    const pass =
        actual === tc.expected ||
        actual
            .split(' ')
            .sort((a, b) => a.localeCompare(b))
            .join(' ') ===
            tc.expected
                .split(' ')
                .sort((a, b) => a.localeCompare(b))
                .join(' ');

    if (pass) {
        console.log(`✅ ${tc.name}: Passed`);
    } else {
        console.log(`❌ ${tc.name}: Failed`);
        console.log(`   Expected: ${tc.expected}`);
        console.log(`   Actual:   ${actual}`);
        failed++;
    }
});

if (failed === 0) {
    console.log('\n✨ All tests passed!');
    process.exit(0);
} else {
    console.log(`\n💥 ${failed} tests failed.`);
    process.exit(1);
}
