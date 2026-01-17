import { MangleMapViewer } from '@/components/mangle-map-viewer';

export default function MangleMapPage() {
    return (
        <main sz={{ minH: 'screen', p: 8, bg: 'slate-900' }}>
            <div sz={{ maxW: '6xl', mx: 'auto' }}>
                <MangleMapViewer />
            </div>
        </main>
    );
}
