/**
 * Fixture for the recovery-token e2e test (packages/e2e/tests/recovery-manifest.spec.ts).
 *
 * The csszyx unplugin's compiler visitor must:
 *   1. Detect each `szRecover="csr"` / `szRecover="dev-only"` JSX attribute.
 *   2. Tag the parent element with a deterministic `data-sz-recovery-token`.
 *   3. Aggregate the tokens into a manifest.
 *   4. Inject `<script id="__SZ_RECOVERY_MANIFEST__">…</script>` into the SSR HTML.
 *
 * The Playwright spec navigates here, asserts every step.
 */

import { useEffect, useState } from 'react';

export function RecoveryFixture() {
  const [unknownMode] = useState('ssr');

  return (
    <main sz={{ p: 8, fontFamily: 'sans' }}>
      <h1 sz={{ text: '2xl', fontWeight: 'bold', mb: 4 }} data-testid="title">
        Recovery Manifest E2E Fixture
      </h1>

      {/* csr mode — should appear in the manifest in both dev and prod */}
      <section
        sz={{ p: 4, bg: 'blue-100', rounded: 'md', mb: 2 }}
        szRecover="csr"
        data-testid="csr-section"
      >
        csr mode
      </section>

      {/* dev-only mode — manifest entry stripped in production builds */}
      <section
        sz={{ p: 4, bg: 'amber-100', rounded: 'md', mb: 2 }}
        szRecover="dev-only"
        data-testid="dev-only-section"
      >
        dev-only mode
      </section>

      {/* Unknown mode — the visitor should warn and emit no token */}
      <section
        sz={{ p: 4, bg: 'red-100', rounded: 'md', mb: 2 }}
        szRecover={unknownMode as 'csr' | 'dev-only'}
        data-testid="unknown-mode-section"
      >
        unknown mode (no token expected)
      </section>

      <ManifestProbe />
    </main>
  );
}

/**
 * Read-side helper: surfaces the manifest's presence and shape into the DOM
 * so the Playwright spec can read it without parsing the script tag itself.
 */
function ManifestProbe() {
  const [info, setInfo] = useState<string>('pending');

  useEffect(() => {
    const script = document.getElementById('__SZ_RECOVERY_MANIFEST__');
    if (!script) {
      setInfo('manifest-missing');
      return;
    }
    try {
      const parsed = JSON.parse(script.textContent ?? '{}');
      setInfo(JSON.stringify({
        buildId: typeof parsed.buildId === 'string',
        checksum: typeof parsed.checksum === 'string',
        tokenCount: Object.keys(parsed.tokens ?? {}).length,
      }));
    } catch (e) {
      setInfo(`parse-error: ${(e as Error).message}`);
    }
  }, []);

  return <pre data-testid="manifest-probe">{info}</pre>;
}
