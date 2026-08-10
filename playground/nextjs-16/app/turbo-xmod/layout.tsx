// A segment layout, not a root one: it inherits the root `<html>` and adds
// this route's own stylesheet. That is what keeps its CSS independent of the
// shared entry without restructuring every other route.
import './xmod.css';

export default function CrossModuleLayout({ children }: { children: React.ReactNode }) {
    return children;
}
