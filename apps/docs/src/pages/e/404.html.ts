/**
 * What `/e/<code>` answers for a code the site does not know: Cloudflare Pages
 * serves the nearest `404.html` up the path, with status 404.
 */
import type { APIRoute } from 'astro';

import { renderUnknownCodePage } from '../../utils/diagnostic-page';

export const GET: APIRoute = () =>
    new Response(renderUnknownCodePage(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
