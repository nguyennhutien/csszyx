import { describe, expect, it } from 'vitest';

import { handleReverse } from '../src/tools/reverse';

describe('csszyx_reverse tool', () => {
    it('should convert Tailwind classes to sz object', async () => {
        const classes = 'p-4 bg-red-500';
        const result = handleReverse({ classes });
        const data = JSON.parse(result.content[0].text);

        expect(data.szObject.p).toBe(4);
        expect(data.szObject.bg).toBe('red-500');
    });

    it('should report unrecognized classes', async () => {
        const classes = 'p-4 unknown-class';
        const result = handleReverse({ classes });
        const data = JSON.parse(result.content[0].text);

        expect(data.szObject.p).toBe(4);
        expect(data.unrecognized).toContain('unknown-class');
    });
});
