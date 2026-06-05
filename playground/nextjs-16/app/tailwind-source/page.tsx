export default function TailwindSourceProbe() {
    return (
        <main className="min-h-screen bg-white p-8 text-slate-950">
            <h1 className="mb-4 text-3xl font-bold">Tailwind @source probe</h1>
            <div
                data-testid="next16-source-target"
                className="p-4 csszyx-source-p8 csszyx-source-bg"
            >
                Runtime classes are expected to receive CSS after csszyx-classes.html
                includes real Tailwind utilities.
            </div>
        </main>
    );
}
