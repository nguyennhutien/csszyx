/**
 * `https://csszyx.com/e/<code>`: one flat `e/<code>.html` per diagnostic id,
 * so the URL every message prints answers without a redirect.
 */
import type { APIRoute, GetStaticPaths } from 'astro';

import { DIAGNOSTIC_DATA, diagnosticPages } from '../../utils/diagnostic-page';

export const getStaticPaths = (() =>
    diagnosticPages(DIAGNOSTIC_DATA).map(([code, html]) => ({
        params: { code },
        props: { html },
    }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
    new Response(props.html as string, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
