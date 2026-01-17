import { useState } from 'react';
import { VerificationComponent } from './Verification';

function App() {
  const [count, setCount] = useState(0);
  const [isActive, setIsActive] = useState(false);

  return (
    <div sz={{ minH: 'screen', bgImg: { gradient: 'linear', dir: 'to-br' }, from: 'purple-500', to: 'pink-500', flex: true, items: 'center', justify: 'center', p: 8 }}>
      <div sz={{ maxW: '2xl', w: 'full', bg: 'white', rounded: '2xl', shadow: '2xl', p: 8 }}>
        <VerificationComponent />
        <h1 sz={{ text: '4xl', font: 'bold', color: 'gray-900', mb: 4 }}>
          🌊 csszyx Playground
        </h1>

        <p sz={{ text: 'gray-600', mb: 8 }}>
          Testing Tailwind class mangling with the <code sz={{ px: 2, py: 1, bg: 'gray-100', rounded: true, text: 'sm', font: 'mono' }}>sz</code> prop
        </p>

        {/* Basic Transform Test */}
        <div sz={{ mb: 8, p: 6, bg: 'blue-50', rounded: 'lg', border: 'blue-200' }}>
          <h2 sz={{ text: 'xl', font: 'semibold', color: 'blue-900', mb: 3 }}>Counter Test</h2>
          <div sz={{ flex: true, items: 'center', gap: 4 }}>
            <button
              onClick={() => setCount(c => c - 1)}
              sz={{ px: 4, py: 2, bg: 'red-500', text: 'white', rounded: 'lg', hover: { bg: 'red-600' }, transition: 'colors' }}
            >
              Decrement
            </button>
            <span sz={{ text: '2xl', font: 'bold', color: 'gray-900' }}>{count}</span>
            <button
              onClick={() => setCount(c => c + 1)}
              sz={{ px: 4, py: 2, bg: 'green-500', text: 'white', rounded: 'lg', hover: { bg: 'green-600' }, transition: 'colors' }}
            >
              Increment
            </button>
          </div>
        </div>

        {/* Conditional Class Test */}
        <div sz={{ mb: 8, p: 6, bg: 'purple-50', rounded: 'lg', border: 'purple-200' }}>
          <h2 sz={{ text: 'xl', font: 'semibold', color: 'purple-900', mb: 3 }}>Conditional Test</h2>
          <button
            onClick={() => setIsActive(!isActive)}
            sz={isActive
              ? { px: 6, py: 3, bg: 'green-500', text: 'white', rounded: 'lg', font: 'medium', transition: 'all' }
              : { px: 6, py: 3, bg: 'gray-300', text: 'gray-700', rounded: 'lg', font: 'medium', transition: 'all' }
            }
          >
            {isActive ? '✓ Active' : '○ Inactive'}
          </button>
        </div>

        {/* Complex Styles Test */}
        <div sz={{ p: 6, bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'cyan-50', to: 'blue-50', rounded: 'lg', border: 'cyan-200' }}>
          <h2 sz={{ text: 'xl', font: 'semibold', color: 'cyan-900', mb: 3 }}>Complex Styles</h2>
          <div sz={{ grid: true, gridCols: 3, gap: 4 }}>
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

        {/* Instructions */}
        <div sz={{ mt: 8, p: 4, bg: 'yellow-50', border: 'yellow-200', rounded: 'lg' }}>
          <p sz={{ text: 'sm', color: 'yellow-900', font: 'medium', mb: 2 }}>🔍 Inspection Tips:</p>
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
