/**
 * `https://csszyx.com/e/<code>`: one flat `e/<code>.html` per diagnostic id,
 * so the URL every message prints answers without a redirect.
 */
import type { APIRoute, GetStaticPaths } from 'astro';

import data from '../../data/diagnostics.json';
import { type DiagnosticData, diagnosticPages } from '../../utils/diagnostic-page';

export const getStaticPaths = (() =>
    diagnosticPages(data as DiagnosticData).map(([code, html]) => ({
        params: { code },
        props: { html },
    }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
    new Response(props.html as string, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
