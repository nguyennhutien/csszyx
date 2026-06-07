// Broad-glob Turbopack fixture entry. Cross-imports two sibling .tsx modules
// (both matched by the same broad rule) — this is the shape that produced the
// `./X.tsx.tsx` failure when the rule set `as`. With the corrected recipe (no
// `as`) the build resolves the imports and renders both.
import { Card } from './card';
import { Plain } from './plain';

export default function TurboBroadPage() {
    return (
        <main
            data-testid="turbo-broad"
            sz={{ display: 'flex', flexDir: 'col', gap: 4, p: 8 }}
        >
            <h1 sz={{ text: '2xl', fontWeight: 'bold' }}>Turbo broad-glob fixture</h1>
            <Card title="Card A" />
            <Card title="Card B" />
            <Plain label="No sz here" />
        </main>
    );
}
