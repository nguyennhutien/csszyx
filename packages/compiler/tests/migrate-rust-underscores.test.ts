/**
 * The `_` of an arbitrary value across the migrate binding: the questions
 * come back from every entry point, each with what migrate wrote unasked,
 * and the answers go in through each and change only what they answer.
 */
import { describe, expect, it } from 'vitest';

import { migrateRustBatch, migrateRustClassName, migrateRustHtml } from '../src/migrate-rust.js';

const QUESTION = {
    class: 'bg-[url(/a_b.png)]',
    value: 'url(/a_b.png)',
    reading: 'url(/a b.png)',
};
/** The project's Tailwind keeps the `_` of a `url()`. */
const KEPT = new Map([['url(/a_b.png)', 'url(/a_b.png)']]);

describe('migrate and the `_` of an arbitrary value', () => {
    it('asks about the value from a className, and writes the answer back', () => {
        const unasked = migrateRustClassName('bg-[url(/a_b.png)] p-4');
        expect(unasked.szObject).toMatchObject({ bg: 'url(/a b.png)', p: 4 });
        expect(unasked.underscoreQuestions).toEqual([QUESTION]);

        const answered = migrateRustClassName('bg-[url(/a_b.png)] p-4', { underscores: KEPT });
        expect(answered.szObject).toMatchObject({ bg: 'url(/a_b.png)', p: 4 });
        expect(answered).not.toHaveProperty('underscoreQuestions');
    });

    it('asks from a source and from HTML, and leaves a file with no `_` without the field', () => {
        const source = 'export const A = () => <div className="bg-[url(/a_b.png)]" />;';
        const [unasked] = migrateRustBatch([{ filename: 'A.tsx', source }]);
        expect(unasked?.stats.underscoreQuestions).toEqual([QUESTION]);
        const [answered] = migrateRustBatch([{ filename: 'A.tsx', source }], {
            underscores: KEPT,
        });
        expect(answered?.code).toContain("'url(/a_b.png)'");
        expect(answered?.stats).not.toHaveProperty('underscoreQuestions');

        const html = '<div class="bg-[url(/a_b.png)]"></div>';
        expect(migrateRustHtml(html).stats.underscoreQuestions).toEqual([QUESTION]);
        expect(migrateRustHtml(html, { underscores: KEPT }).code).toContain('url(/a_b.png)');

        const [plain] = migrateRustBatch([
            { filename: 'B.tsx', source: 'export const B = () => <div className="p-4" />;' },
        ]);
        expect(plain?.stats).not.toHaveProperty('underscoreQuestions');
    });
});
