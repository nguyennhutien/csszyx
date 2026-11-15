/**
 * An import the plugin injects goes after a module's `'use client'` or
 * `'use server'` directive: one in front of it would end the directive
 * prologue, and the directive would become a plain string that Next and the
 * RSC boundary check no longer read. The directive need not be the first one.
 */
import { describe, expect, it } from 'vitest';

import { insertAfterUseDirective, readDirectivePrologue } from '../src/directive-prologue.js';
import { hasUseClientDirective, hasUseServerDirective } from '../src/rsc-boundary.js';

const IMPORT = "import 'x';\n";

describe('insertAfterUseDirective', () => {
    it.each([
        ["'use client';\nexport const a = 1;", "'use client';\nimport 'x';\nexport const a = 1;"],
        ['"use server"\nexport const a = 1;', '"use server"\nimport \'x\';\nexport const a = 1;'],
        [
            "// banner\n/* c */ 'use client';\n\nexport const a = 1;",
            "// banner\n/* c */ 'use client';\n\nimport 'x';\nexport const a = 1;",
        ],
        ["﻿'use client';\nx();", "﻿'use client';\nimport 'x';\nx();"],
        [
            "'use strict';\n'use client';\nexport const a = 1;",
            "'use strict';\n'use client';\nimport 'x';\nexport const a = 1;",
        ],
        [
            "'use client';\n'use strict';\nexport const a = 1;",
            "'use client';\nimport 'x';\n'use strict';\nexport const a = 1;",
        ],
        [
            "'use strict' /* c */ ;\n'use client';\nexport const a = 1;",
            "'use strict' /* c */ ;\n'use client';\nimport 'x';\nexport const a = 1;",
        ],
        ["'use strict'\v;'use client';x()", "'use strict'\v;'use client';import 'x';\nx()"],
        ["'use strict' ;'use client';x()", "'use strict' ;'use client';import 'x';\nx()"],
        [
            "'use strict' // c\n;'use client';x()",
            "'use strict' // c\n;'use client';import 'x';\nx()",
        ],
        [
            "'use client' // note\nexport const a = 1;",
            "'use client' \nimport 'x';\n// note\nexport const a = 1;",
        ],
        ["'use client'", "'use client'\nimport 'x';\n"],
        [
            "#!/usr/bin/env node\n'use client';\nx();",
            "#!/usr/bin/env node\n'use client';\nimport 'x';\nx();",
        ],
    ])('keeps the directive in front of the import in %j', (code, expected) => {
        const out = insertAfterUseDirective(code, IMPORT);
        expect(out).toBe(expected);
        expect(hasUseClientDirective(out) || hasUseServerDirective(out)).toBe(true);
    });

    it.each([
        ['export const a = 1;'],
        ["'use strict';\nexport const a = 1;"],
        ["const s = 'use client';"],
        ["// 'use client'\nexport const a = 1;"],
        ["'use client'\n(a)"],
        ["'use client' + 'x';"],
        ["'a';;'use client';x()"],
        ["'use\\x20client';x()"],
    ])('puts the import first when no use directive leads %j', code => {
        expect(insertAfterUseDirective(code, IMPORT)).toBe(IMPORT + code);
    });

    it.each([
        ['#!/usr/bin/env node\nx();', "#!/usr/bin/env node\nimport 'x';\nx();"],
        ['#!/usr/bin/env node', "#!/usr/bin/env node\nimport 'x';\n"],
    ])('keeps a hashbang on the first line of %j', (code, expected) => {
        expect(insertAfterUseDirective(code, IMPORT)).toBe(expected);
    });
});

describe('readDirectivePrologue', () => {
    it.each([
        ["'use client'; 'use strict'\nx();", ["'use client';", "'use strict'"]],
        ["'a\\\\'; 'b'", ["'a\\\\';", "'b'"]],
        ["'use client'; f('x')", ["'use client';"]],
        ["'use client' + 'x'", []],
        ["'use client' ;", ["'use client';"]],
        ["'a';;'b'", ["'a';"]],
        ["'a'\n'b'", ["'a'", "'b'"]],
        ["'a' /* x\n */ 'b'", ["'a'", "'b'"]],
        ["'a' /* x */ 'b'", []],
        ["'a'\n++x", ["'a'"]],
        ["'a'\n--x", ["'a'"]],
        ["'a'\n!b", ["'a'"]],
        ["'a'\n!= b", []],
        ["'a'\nb", ["'a'"]],
        ["'a'\ninstanceof b", []],
        ["'a'\nin b", []],
        ["'a'\ninput", ["'a'"]],
        ["'a'\n.b", []],
        ["'a'\n`b`", []],
        ['`use client`;', []],
        ["'use client\n';", []],
        ['"\\"', []],
        ['"', []],
    ])('reads %j as JavaScript does', (code, statements) => {
        expect(readDirectivePrologue(code).map(({ statement }) => statement)).toEqual(statements);
    });

    it.each([
        ["'use server' ;\nx()", 'server'],
        ["'use server'\n;x()", 'server'],
        ["'use client' /* c */ ;x()", 'client'],
    ])('lets the boundary check read %j as a %s module', (code, kind) => {
        expect(hasUseServerDirective(code)).toBe(kind === 'server');
        expect(hasUseClientDirective(code)).toBe(kind === 'client');
    });
});
