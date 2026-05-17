/**
 * Spec Test Runner for Phase 2
 *
 * Runs all 1,783 generated test cases against the transform function.
 * TDD approach: establish baseline → implement fixes → iterate to 95%+
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs';

import { transform } from '../packages/compiler/src/transform.js';

/**
 *
 */
interface TestCase {
  id: string;
  szInput: Record<string, unknown>;
  expectedClass: string;
  category?: string;
  subcategory?: string;
}

/**
 *
 */
interface SpecTests {
  totalTests: number;
  tests: TestCase[];
}

/**
 *
 */
interface FailureEntry {
  id: string;
  expected: string;
  got: string;
  input: unknown;
  category?: string;
}

// Load spec tests
const specTests: SpecTests = JSON.parse(
    readFileSync('./tests/generated/spec-tests.json', 'utf-8'),
);
const total = specTests.totalTests || specTests.tests.length;

let passed = 0;
let failed = 0;
const failures: FailureEntry[] = [];
const categoryStats: Record<string, { passed: number; failed: number }> = {};

/**
 * Normalize class string for comparison
 * Sorts classes alphabetically to handle ordering differences
 * @param cls - Class string to normalize
 * @returns Normalized class string
 */
function normalizeClass(cls: string): string {
    return cls.split(' ').filter(Boolean).sort().join(' ');
}

console.log('='.repeat(60));
console.log('Phase 2 Spec Test Runner');
console.log('='.repeat(60));
console.log(`Total tests: ${total}`);
console.log('');

console.time('transform-all');

for (const test of specTests.tests) {
    try {
        const result = transform(test.szInput as Parameters<typeof transform>[0]);
        // Handle both string return and object return
        const actual = typeof result === 'string' ? result : result.className;

        const normalizedActual = normalizeClass(actual);
        const normalizedExpected = normalizeClass(test.expectedClass);

        // Track category stats
        const category = test.category || 'Unknown';
        if (!categoryStats[category]) {
            categoryStats[category] = { passed: 0, failed: 0 };
        }

        if (normalizedActual === normalizedExpected) {
            passed++;
            categoryStats[category].passed++;
        } else {
            failed++;
            categoryStats[category].failed++;
            failures.push({
                id: test.id,
                expected: test.expectedClass,
                got: actual,
                input: test.szInput,
                category: test.category,
            });
        }
    } catch (err) {
        failed++;
        const category = test.category || 'Unknown';
        if (!categoryStats[category]) {
            categoryStats[category] = { passed: 0, failed: 0 };
        }
        categoryStats[category].failed++;
        failures.push({
            id: test.id,
            expected: test.expectedClass,
            got: `ERROR: ${(err as Error).message}`,
            input: test.szInput,
            category: test.category,
        });
    }
}

console.timeEnd('transform-all');
console.log('');

// Results summary
const passRate = ((passed / total) * 100).toFixed(1);
console.log('='.repeat(60));
console.log('RESULTS');
console.log('='.repeat(60));
console.log(`Passed:    ${passed}`);
console.log(`Failed:    ${failed}`);
console.log(`Total:     ${total}`);
console.log(`Pass Rate: ${passRate}%`);
console.log('');

// Category breakdown
console.log('='.repeat(60));
console.log('CATEGORY BREAKDOWN');
console.log('='.repeat(60));
const sortedCategories = Object.entries(categoryStats)
    .sort((a, b) => b[1].failed - a[1].failed);

for (const [category, stats] of sortedCategories) {
    const catTotal = stats.passed + stats.failed;
    const catRate = ((stats.passed / catTotal) * 100).toFixed(0);
    const indicator = stats.failed > 0 ? '❌' : '✅';
    console.log(`${indicator} ${category.padEnd(25)} ${stats.passed}/${catTotal} (${catRate}%)`);
}
console.log('');

// Sample failures (first 30)
if (failures.length > 0) {
    console.log('='.repeat(60));
    console.log('SAMPLE FAILURES (first 30)');
    console.log('='.repeat(60));

    failures.slice(0, 30).forEach((f, i) => {
        console.log(`\n${i + 1}. ${f.id}`);
        console.log(`   Input:    ${JSON.stringify(f.input)}`);
        console.log(`   Expected: "${f.expected}"`);
        console.log(`   Got:      "${f.got}"`);
    });
}

// Analyze failure patterns
console.log('');
console.log('='.repeat(60));
console.log('FAILURE PATTERN ANALYSIS');
console.log('='.repeat(60));

const patterns: Record<string, number> = {};
for (const f of failures) {
    // Extract pattern from test ID
    const parts = f.id.split('-');
    const pattern = parts.slice(0, 2).join('-');
    patterns[pattern] = (patterns[pattern] || 0) + 1;
}

const sortedPatterns = Object.entries(patterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

console.log('Top 20 failure patterns by ID prefix:');
for (const [pattern, count] of sortedPatterns) {
    console.log(`  ${pattern.padEnd(30)} ${count} failures`);
}

// Export failures to file for PM review
if (failures.length > 0) {
    try {
        mkdirSync('./.agent/logs', { recursive: true });

        const failureReport = `# Phase 2 Test Failures Report

Generated: ${new Date().toISOString()}
Pass Rate: ${passRate}% (${passed}/${total})

## Summary

- **Passed:** ${passed}
- **Failed:** ${failed}
- **Total:** ${total}

## Category Breakdown

| Category | Passed | Failed | Rate |
|----------|--------|--------|------|
${sortedCategories.map(([cat, stats]) => {
        const catTotal = stats.passed + stats.failed;
        const catRate = ((stats.passed / catTotal) * 100).toFixed(0);
        return `| ${cat} | ${stats.passed} | ${stats.failed} | ${catRate}% |`;
    }).join('\n')}

## Top Failure Patterns

${sortedPatterns.map(([pattern, count]) => `- \`${pattern}\`: ${count} failures`).join('\n')}

## All Failures

${failures.map((f, i) => `### ${i + 1}. ${f.id}

- **Input:** \`${JSON.stringify(f.input)}\`
- **Expected:** \`${f.expected}\`
- **Got:** \`${f.got}\`
`).join('\n')}
`;

        writeFileSync('./.agent/logs/phase2-failures.md', failureReport);
        console.log('\n✅ Full failure report exported to .agent/logs/phase2-failures.md');
    } catch (err) {
        console.log(`\n⚠️ Could not export failure report: ${(err as Error).message}`);
    }
}

// Exit code based on pass rate
const targetPassRate = 95;
if (parseFloat(passRate) >= targetPassRate) {
    console.log(`\n🎉 SUCCESS! Pass rate ${passRate}% meets target of ${targetPassRate}%`);
    process.exit(0);
} else {
    console.log(`\n⚠️ Pass rate ${passRate}% below target of ${targetPassRate}%`);
    process.exit(1);
}
