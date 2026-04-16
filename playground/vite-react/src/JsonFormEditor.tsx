/**
 * JsonFormEditor — demo dùng cả 2 path của csszyx:
 *   - sz={{ }}  build-time prop: unplugin transform → Tailwind JIT → static CSS
 *   - sz()      runtime hook:    useSz() inject CSS vào adoptedStyleSheets live
 */
import { useEffect, useRef, useState } from 'react';
import { useSz } from '@csszyx/dynamic/react';
import type { SzObject } from '@csszyx/dynamic';

interface FieldConfig {
    name: string;
    label: string;
    style: SzObject;
}

const DEFAULT_CONFIG: FieldConfig[] = [
    { name: 'firstName', label: 'First Name', style: { p: 3, border: true, rounded: 'md',   w: 'full', bg: 'white' } },
    { name: 'lastName',  label: 'Last Name',  style: { p: 3, border: 2,    rounded: 'lg',   w: 'full', bg: 'white' } },
    { name: 'email',     label: 'Email',      style: { p: 3, border: true, rounded: 'none', w: 'full', bg: 'yellow-50' } },
    { name: 'phone',     label: 'Phone',      style: { p: 2, border: true, rounded: 'full', w: 'full', bg: 'blue-50' } },
];

export function JsonFormEditor() {
    // sz() — runtime injection path (useSz hook)
    const { sz } = useSz();

    const [jsonText, setJsonText] = useState(JSON.stringify(DEFAULT_CONFIG, null, 2));
    const [fields, setFields] = useState<FieldConfig[]>(DEFAULT_CONFIG);
    const [parseError, setParseError] = useState<string | null>(null);
    const [sheetInfo, setSheetInfo] = useState({ sheets: 0, rules: 0 });
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();

    useEffect(() => {
        const id = setInterval(() => {
            const sheets = Array.from(document.adoptedStyleSheets);
            let rules = 0;
            for (const s of sheets) rules += s.cssRules.length;
            setSheetInfo({ sheets: sheets.length, rules });
        }, 500);
        return () => clearInterval(id);
    }, []);

    function handleJsonChange(text: string) {
        // Update textarea immediately for responsive typing feel
        setJsonText(text);
        // Debounce the actual parse + sz() injection — avoids garbage classes
        // from partial input (e.g. typing "red-500" char-by-char = 7 orphaned classes)
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            try {
                const parsed = JSON.parse(text);
                if (!Array.isArray(parsed)) throw new Error('Root must be an array');
                setFields(parsed as FieldConfig[]);
                setParseError(null);
            } catch (e) {
                setParseError((e as Error).message);
            }
        }, 400);
    }

    return (
        // sz={{ }} — build-time path: unplugin transforms to className at build/dev
        <div sz={{ minH: 'screen', bg: 'gray-950', p: 6, fontFamily: 'mono' }}>

            {/* Header */}
            <div sz={{ mb: 6 }}>
                <h1 sz={{ text: '2xl', fontWeight: 'bold', color: 'white', mb: 1 }}>
                    @csszyx/dynamic — Live JSON Editor
                </h1>
                <p sz={{ text: 'sm', color: 'gray-400' }}>
                    Edit field configs on the left →{' '}
                    <code sz={{ color: 'emerald-400' }}>useSz()</code>
                    {' '}injects new CSS rules live on the right.
                </p>
            </div>

            {/* Two-panel layout */}
            <div sz={{ grid: true, gridCols: 2, gap: 6, items: 'start' }}>

                {/* Left: JSON editor */}
                <div sz={{ flex: true, flexDir: 'col', gap: 2 }}>
                    <div sz={{ flex: true, items: 'center', justify: 'between', mb: 1 }}>
                        <span sz={{ text: 'xs', fontWeight: 'semibold', color: 'gray-400' }}>
                            FIELD CONFIG (JSON)
                        </span>
                        {parseError
                            ? <span sz={{ text: 'xs', color: 'red-400' }}>✗ {parseError}</span>
                            : <span sz={{ text: 'xs', color: 'emerald-400' }}>✓ valid</span>
                        }
                    </div>
                    <textarea
                        value={jsonText}
                        onChange={e => handleJsonChange(e.target.value)}
                        spellCheck={false}
                        style={{ height: '60vh' }}
                        sz={{
                            w: 'full',
                            p: 4,
                            bg: 'gray-900',
                            color: 'emerald-300',
                            border: true,
                            borderColor: 'gray-700',
                            rounded: 'lg',
                            text: 'sm',
                            leading: 'relaxed',
                            fontFamily: 'mono',
                            outline: 'none',
                            resize: 'none',
                        }}
                    />
                    <p sz={{ text: 'xs', color: 'gray-600' }}>
                        Tip: change{' '}
                        <code sz={{ color: 'gray-400' }}>rounded</code>,{' '}
                        <code sz={{ color: 'gray-400' }}>bg</code>,{' '}
                        <code sz={{ color: 'gray-400' }}>p</code>
                        {' '}→ new CSS rules inject instantly.
                    </p>
                </div>

                {/* Right: live preview + stats */}
                <div sz={{ flex: true, flexDir: 'col', gap: 4 }}>

                    {/* Stats bar */}
                    <div sz={{ flex: true, gap: 6, p: 4, bg: 'gray-900', border: true, borderColor: 'gray-700', rounded: 'lg' }}>
                        <div>
                            <div sz={{ text: 'xs', color: 'gray-500', mb: 1 }}>adoptedStyleSheets</div>
                            <div sz={{ text: '2xl', fontWeight: 'bold', color: 'emerald-400' }}>{sheetInfo.sheets}</div>
                        </div>
                        <div>
                            <div sz={{ text: 'xs', color: 'gray-500', mb: 1 }}>injected rules</div>
                            <div sz={{ text: '2xl', fontWeight: 'bold', color: 'blue-400' }}>{sheetInfo.rules}</div>
                        </div>
                        <div sz={{ self: 'end', pb: 1, text: 'xs', color: 'gray-600' }}>
                            live · 500ms poll
                        </div>
                    </div>

                    {/* Live preview — inputs styled via sz() runtime */}
                    <div sz={{ p: 6, bg: 'gray-900', border: true, borderColor: 'gray-700', rounded: 'lg' }}>
                        <span sz={{ text: 'xs', fontWeight: 'semibold', color: 'gray-400', block: true, mb: 4 }}>
                            LIVE PREVIEW
                        </span>
                        {fields.length === 0
                            ? (
                                <p sz={{ text: 'sm', color: 'gray-500', textAlign: 'center', py: 8 }}>
                                    Add fields to the JSON.
                                </p>
                            )
                            : (
                                <form noValidate>
                                    {fields.map((field, i) => (
                                        <div key={field.name ?? i} sz={{ mb: 4 }}>
                                            <label sz={{ text: 'xs', fontWeight: 'medium', color: 'gray-400', block: true, mb: 1 }}>
                                                {field.label ?? field.name}
                                            </label>
                                            {/* sz() runtime — injects CSS for each unique style combo from JSON */}
                                            <input
                                                type="text"
                                                placeholder={field.label ?? field.name}
                                                className={sz(field.style ?? {})}
                                            />
                                        </div>
                                    ))}
                                </form>
                            )
                        }
                    </div>
                </div>
            </div>
        </div>
    );
}
