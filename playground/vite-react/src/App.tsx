import { lazy, Suspense, useState } from 'react';
import { RecoveryFixture } from './Recovery';
import { VerificationComponent } from './Verification';

// Lazy-load DynamicForm so @csszyx/dynamic (and its deps) are NOT bundled into
// the main chunk. This avoids a WASM pre-transform warning from Vite when the
// @csszyx/core WASM is encountered during regular page loads.
const DynamicForm = lazy(() => import('./DynamicForm').then(m => ({ default: m.DynamicForm })));
const JsonFormEditor = lazy(() => import('./JsonFormEditor').then(m => ({ default: m.JsonFormEditor })));

function CssVarFixture() {
  const [pad, setPad] = useState(4);

  return (
    <section data-testid="css-var-fixture" sz={{ minH: 'screen', p: 6, bg: 'white' }}>
      <h1 sz={{ text: '2xl', weight: 'bold', mb: 4 }}>CSS variable fixture</h1>
      <button
        data-testid="css-var-button"
        onClick={() => setPad(value => value + 1)}
        sz={{ px: 4, py: 2, bg: 'blue-600', color: 'white', rounded: 'md', mb: 4 }}
      >
        Increase spacing
      </button>
      <div data-testid="css-var-card-a" sz={{ p: pad, bg: 'blue-50', rounded: 'md' }}>
        Shared dynamic padding A
      </div>
      <span data-testid="css-var-card-b" sz={{ p: pad, display: 'block', bg: 'green-50', rounded: 'md', mt: 3 }}>
        Shared dynamic padding B
      </span>
    </section>
  );
}

function App() {
  const [count, setCount] = useState(0);
  const [isActive, setIsActive] = useState(false);

  const page = new URLSearchParams(window.location.search).get('page');

  if (page === 'dynamic') {
    return (
      <Suspense fallback={<div>Loading…</div>}>
        <DynamicForm />
      </Suspense>
    );
  }

  if (page === 'editor') {
    return (
      <Suspense fallback={<div>Loading…</div>}>
        <JsonFormEditor />
      </Suspense>
    );
  }

  if (page === 'css-vars') {
    return <CssVarFixture />;
  }

  if (page === 'recovery') {
    return <RecoveryFixture />;
  }

  return (
    <div sz={{ minH: 'screen', bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'purple-500', to: 'pink-500', display: 'flex', items: 'center', justify: 'center', p: 8 }}>
      <div sz={{ maxW: '2xl', w: 'full', bg: 'white', rounded: '2xl', shadow: '2xl', p: 8 }}>
        <VerificationComponent />
        <h1 sz={{ text: '4xl', weight: 'bold', color: 'gray-900', mb: 4 }}>
          🌊 csszyx Playground
        </h1>

        <p sz={{ color: 'gray-600', mb: 8 }}>
          Testing Tailwind class mangling with the <code sz={{ px: 2, py: 1, bg: 'gray-100', rounded: true, text: 'sm', fontFamily: 'mono' }}>sz</code> prop
        </p>

        {/* Basic Transform Test */}
        <div sz={{ mb: 8, p: 6, bg: 'blue-50', rounded: 'lg', borderColor: 'blue-200', border: true }}>
          <h2 sz={{ text: 'xl', weight: 'semibold', color: 'blue-900', mb: 3 }}>Counter Test</h2>
          <div sz={{ display: 'flex', items: 'center', gap: 4 }}>
            <button
              onClick={() => setCount(c => c - 1)}
              sz={{ px: 4, py: 2, bg: 'red-500', color: 'white', rounded: 'lg', hover: { bg: 'red-600' }, transition: 'colors' }}
            >
              Decrement
            </button>
            <span sz={{ text: '2xl', weight: 'bold', color: 'gray-900' }}>{count}</span>
            <button
              onClick={() => setCount(c => c + 1)}
              sz={{ px: 4, py: 2, bg: 'green-500', color: 'white', rounded: 'lg', hover: { bg: 'green-600' }, transition: 'colors' }}
            >
              Increment
            </button>
          </div>
        </div>

        {/* Conditional Class Test */}
        <div sz={{ mb: 8, p: 6, bg: 'purple-50', rounded: 'lg', borderColor: 'purple-200', border: true }}>
          <h2 sz={{ text: 'xl', weight: 'semibold', color: 'purple-900', mb: 3 }}>Conditional Test</h2>
          <button
            onClick={() => setIsActive(!isActive)}
            sz={isActive
              ? { px: 6, py: 3, bg: 'green-500', color: 'white', rounded: 'lg', fontWeight: 'medium', transition: 'all' }
              : { px: 6, py: 3, bg: 'gray-300', color: 'gray-700', rounded: 'lg', fontWeight: 'medium', transition: 'all' }
            }
          >
            {isActive ? '✓ Active' : '○ Inactive'}
          </button>
        </div>

        {/* Complex Styles Test */}
        <div sz={{ p: 6, bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'cyan-50', to: 'blue-50', rounded: 'lg', borderColor: 'cyan-200', border: true }}>
          <h2 sz={{ text: 'xl', weight: 'semibold', color: 'cyan-900', mb: 3 }}>Complex Styles</h2>
          <div sz={{ display: 'grid', gridCols: 3, gap: 4 }}>
            <div sz={{ p: 4, bg: 'white', rounded: true, shadow: true, hover: { shadow: 'lg' }, transition: 'shadow' }}>
              <div sz={{ w: 12, h: 12, bg: 'red-500', rounded: 'full', mb: 2 }}></div>
              <p sz={{ text: 'sm', color: 'gray-600' }}>Red Circle</p>
            </div>
            <div sz={{ p: 4, bg: 'white', rounded: true, shadow: true, hover: { shadow: 'lg' }, transition: 'shadow' }}>
              <div sz={{ w: 12, h: 12, bg: 'green-500', rounded: 'full', mb: 2 }}></div>
              <p sz={{ text: 'sm', color: 'gray-600' }}>Green Circle</p>
            </div>
            <div sz={{ p: 4, bg: 'white', rounded: true, shadow: true, hover: { shadow: 'lg' }, transition: 'shadow' }}>
              <div sz={{ w: 12, h: 12, bg: 'blue-500', rounded: 'full', mb: 2 }}></div>
              <p sz={{ text: 'sm', color: 'gray-600' }}>Blue Circle</p>
            </div>
          </div>
        </div>

        {/* New Features Showcase */}
        <div sz={{ mt: 8, p: 6, bg: 'emerald-50', rounded: 'lg', borderColor: 'emerald-200', border: true }}>
          <h2 sz={{ text: 'xl', weight: 'semibold', color: 'emerald-900', mb: 3 }}>New Features</h2>

          <div sz={{ display: 'grid', gridCols: 2, gap: 4 }}>
            {/* Text/Leading shorthand */}
            <div sz={{ p: 4, bg: 'white', rounded: 'lg', shadow: true }}>
              <h3 sz={{ text: 'sm', weight: 'semibold', color: 'emerald-800', mb: 2 }}>Text/Leading Shorthand</h3>
              <p sz={{ text: 'lg', leading: 7, color: 'gray-700' }}>
                text-lg/7 — font-size + line-height merged into a single class.
              </p>
              <p sz={{ text: 'sm', leading: 'tight', color: 'gray-500', mt: 2 }}>
                text-sm/tight — keyword line-height.
              </p>
            </div>

            {/* Explicit fontWeight / fontFamily */}
            <div sz={{ p: 4, bg: 'white', rounded: 'lg', shadow: true }}>
              <h3 sz={{ text: 'sm', weight: 'semibold', color: 'emerald-800', mb: 2 }}>Explicit Keys</h3>
              <p sz={{ weight: 'bold', color: 'gray-700' }}>fontWeight: bold</p>
              <p sz={{ weight: 'light', color: 'gray-700' }}>fontWeight: light</p>
              <p sz={{ fontFamily: 'mono', color: 'gray-700' }}>fontFamily: mono</p>
              <p sz={{ fontFamily: 'serif', color: 'gray-700' }}>fontFamily: serif</p>
            </div>

            {/* Separate color / textAlign / text */}
            <div sz={{ p: 4, bg: 'white', rounded: 'lg', shadow: true }}>
              <h3 sz={{ text: 'sm', weight: 'semibold', color: 'emerald-800', mb: 2 }}>No Collisions</h3>
              <p sz={{ text: 'lg', color: 'blue-600' }}>text=lg + color=blue-600</p>
              <p sz={{ text: 'sm', textAlign: 'right', color: 'purple-600' }}>text=sm + textAlign=right</p>
              <p sz={{ border: 2, borderColor: 'red-500', p: 2, rounded: 'md', color: 'gray-700', mt: 2 }}>border=2 + borderColor=red-500</p>
            </div>

            {/* Shadow/ring color opacity */}
            <div sz={{ p: 4, bg: 'white', rounded: 'lg', shadow: true }}>
              <h3 sz={{ text: 'sm', weight: 'semibold', color: 'emerald-800', mb: 2 }}>Shadow Color Opacity</h3>
              <div sz={{ p: 3, bg: 'blue-50', rounded: 'md', shadow: 'lg', shadowColor: { color: 'blue-500', op: 50 }, mb: 2 }}>
                shadow-blue-500/50
              </div>
              <div sz={{ p: 3, bg: 'red-50', rounded: 'md', insetShadow: 'sm', insetShadowColor: { color: 'red-500', op: 30 } }}>
                inset-shadow-red-500/30
              </div>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div sz={{ mt: 8, p: 4, bg: 'yellow-50', borderColor: 'yellow-200', border: true, rounded: 'lg' }}>
          <p sz={{ text: 'sm', color: 'yellow-900', weight: 'medium', mb: 2 }}>🔍 Inspection Tips:</p>
          <ul sz={{ text: 'sm', color: 'yellow-800', spaceY: 1 }}>
            <li>• Open DevTools → Inspect elements to see mangled classes</li>
            <li>• Check Network tab → CSS file should have <code sz={{ px: 1, bg: 'yellow-100', rounded: true }}>.z</code>, <code sz={{ px: 1, bg: 'yellow-100', rounded: true }}>.y</code> selectors</li>
            <li>• Open <code sz={{ px: 1, bg: 'yellow-100', rounded: true }}>http://localhost:5174</code> → See mangle map dashboard</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default App;
