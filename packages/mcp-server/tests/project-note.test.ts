/** The note a tool writes beside an answer the project could not give in full. */
import { describe, expect, it } from 'vitest';

import { projectNote } from '../src/tools/project-note';

describe('projectNote', () => {
    const decided = [{ class: '-z-auto' }];
    const spaced = (skipped: string | null) => ({ values: [{ value: 'url(/a_b.png)' }], skipped });

    it('gives a reason once when the table and the `_` share it', () => {
        const note = projectNote(null, 'no Tailwind', decided, spaced('no Tailwind')) ?? '';
        expect(note.match(/no Tailwind/g)).toHaveLength(1);
        expect(note).toContain('`url(/a_b.png)`');
    });

    it('gives a reason once when the prefix and the `_` share it', () => {
        const note =
            projectNote('no package.json', null, undefined, spaced('no package.json')) ?? '';
        expect(note.match(/no package\.json/g)).toHaveLength(1);
    });

    it('gives the reason in full when the table shared its text but decided nothing', () => {
        const note = projectNote(null, 'no Tailwind', [], spaced('no Tailwind')) ?? '';
        expect(note).toContain(': no Tailwind');
    });

    it('gives the `_` its own reason when it differs', () => {
        const note = projectNote(null, null, undefined, spaced('no stylesheet serves its class'));
        expect(note).toContain('no stylesheet serves its class');
    });
});
