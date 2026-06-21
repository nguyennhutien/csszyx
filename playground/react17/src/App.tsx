import { useSz } from '@csszyx/dynamic/react';
import { useState } from 'react';

/**
 * Runtime dynamic styling via the @csszyx/dynamic React hook. This is the part
 * that genuinely exercises React 17 — the hook (useEffect/useCallback/useContext
 * under the hood) must run on 17, and its StrictMode-deferred cleanup must not
 * wipe the injected styles.
 *
 * @returns a card whose padding comes from a runtime sz() call.
 */
function DynamicCard() {
  const { sz } = useSz();
  const [pad, setPad] = useState(4);

  return (
    <div data-testid="dynamic-card" className={sz({ p: pad, bg: 'green-50', rounded: 'md' })}>
      <button
        data-testid="dynamic-button"
        type="button"
        onClick={() => setPad(value => value + 1)}
        sz={{ px: 3, py: 1, bg: 'green-600', color: 'white', rounded: 'md' }}
      >
        Grow padding
      </button>
    </div>
  );
}

/**
 * React 17 smoke-test app. Covers the three things that must work on 17: the
 * build-time sz->className transform (static + conditional) and the runtime
 * dynamic hook package.
 *
 * @returns the smoke-test page.
 */
function App() {
  const [active, setActive] = useState(false);

  return (
    <main sz={{ minH: 'screen', p: 8, bg: 'white' }}>
      <h1 sz={{ text: '4xl', weight: 'bold', mb: 4 }}>csszyx on React 17</h1>

      <button
        data-testid="toggle"
        type="button"
        onClick={() => setActive(value => !value)}
        sz={{
          px: 4,
          py: 2,
          rounded: 'md',
          color: 'white',
          bg: active ? 'blue-600' : 'gray-500',
        }}
      >
        {active ? 'Active' : 'Inactive'}
      </button>

      <DynamicCard />
    </main>
  );
}

export default App;
