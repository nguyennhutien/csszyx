/**
 * Fixture for the safelist HMR e2e.
 *
 * The spec rewrites the padding literal below to a value no other file uses,
 * which is the case that used to full-reload the page: csszyx writes the
 * generated safelist so Tailwind emits the new rule, and Vite reloads for any
 * changed `.html` that matched no module.
 *
 * The literal is part of the contract — the spec asserts it is present before
 * editing, so do not reflow or reformat this line.
 */
import { _szcn, szcn } from '@csszyx/runtime';

export function SafelistHmrFixture() {
  return (
    <div data-testid="safelist-hmr-target" sz={{ pt: 7, bg: 'slate-100' }}>
      safelist hmr fixture
      <output data-testid="safelist-hmr-merge">{szcn('pt-7', 'pt-8')}</output>
      <output data-testid="safelist-hmr-slim-merge">{_szcn('pt-7', 'pt-8')}</output>
    </div>
  );
}
