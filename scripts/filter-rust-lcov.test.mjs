import assert from 'node:assert/strict';
import test from 'node:test';

import { filterRustLcov } from './filter-rust-lcov.mjs';

test('removes inline test instrumentation while preserving production coverage', () => {
    const source = [
        'fn production() {}',
        '',
        '#[cfg(test)]',
        'mod tests {',
        '    fn test_only() {}',
        '}',
    ].join('\n');
    const input = `SF:/repo/packages/core/src/example.rs
FN:1,production
FN:5,test_only
FNDA:1,production
FNDA:1,test_only
FNF:2
FNH:2
DA:1,1
DA:3,0
DA:5,1
LF:3
LH:2
BRDA:1,0,0,1
BRDA:5,0,0,1
BRF:2
BRH:2
end_of_record
`;

    const output = filterRustLcov(input, () => source);

    assert.match(output, /FN:1,production/);
    assert.doesNotMatch(output, /test_only/);
    assert.match(output, /DA:1,1/);
    assert.doesNotMatch(output, /DA:3,0/);
    assert.doesNotMatch(output, /DA:5,1/);
    assert.match(output, /FNF:1\nFNH:1\nLF:1\nLH:1\nBRF:1\nBRH:1/);
});

test('leaves non-core and files without an inline test module unchanged', () => {
    const input = `SF:/repo/packages/other/src/example.rs
DA:1,0
LF:1
LH:0
end_of_record
`;

    assert.equal(filterRustLcov(input), input);
});
