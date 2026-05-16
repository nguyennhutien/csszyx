import * as fs from 'fs';
import * as path from 'path';

const generatedDir = path.resolve('tests/generated');
const outputFile = path.resolve(generatedDir, 'spec-tests.json');

const files = fs
    .readdirSync(generatedDir)
    .filter(f => f.endsWith('.tests.json') && f !== 'spec-tests.json');

let allTests: any[] = [];

console.log('Merging the following files:');
for (const file of files) {
    console.log(`- ${file}`);
    const content = fs.readFileSync(path.join(generatedDir, file), 'utf-8');
    try {
        const json = JSON.parse(content);
        if (json.tests && Array.isArray(json.tests)) {
            allTests = allTests.concat(json.tests);
        }
    } catch (e) {
        console.error(`Error parsing ${file}:`, e);
    }
}

const output = {
    version: 'merged-manual-fixes',
    generatedAt: new Date().toISOString(),
    totalTests: allTests.length,
    tests: allTests,
};

fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
console.log(`\nSuccessfully merged ${allTests.length} tests into ${outputFile}`);
