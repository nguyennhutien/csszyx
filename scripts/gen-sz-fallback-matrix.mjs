#!/usr/bin/env node

/**
 * Generate the Rust copy of the sz runtime-fallback diagnostic matrix.
 *
 * The wording lives in `packages/compiler/src/sz-fallback-matrix.ts`. The two
 * TypeScript lanes import it; Rust cannot, so it gets this generated file. A
 * hand-maintained third copy is exactly the drift this prevents — the three
 * engines must print identical text, because a build can switch between them
 * with `build.parser` and a diagnostic that changes wording on a parser flip
 * reads as a behaviour change.
 *
 * Usage:
 *   node --import tsx/esm scripts/gen-sz-fallback-matrix.mjs           # write
 *   node --import tsx/esm scripts/gen-sz-fallback-matrix.mjs --check   # CI gate
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    describeSzFallback,
    formatSzFallbackDiagnostic,
    SZ_FALLBACK_DETAIL_PLACEHOLDER,
    SZ_FALLBACK_KINDS,
    SZ_FALLBACK_MATRIX,
    SZ_FALLBACK_UNKNOWN_CALLEE,
    szsUnsupportedDiagnostic,
} from '../packages/compiler/src/sz-fallback-matrix.js';

/** Sites the Rust engine can report. `sz` renders through its own call site. */
const RUST_SITES = ['szr', 'szv'];

const repoRoot = path.resolve(import.meta.dirname, '..');
const outPath = path.join(repoRoot, 'packages/core/src/transform/generated/sz_fallback_matrix.rs');

/**
 * Escape text for a Rust string literal.
 *
 * @param {string} text - Raw text.
 * @returns {string} Text safe between double quotes.
 */
export function escapeRustString(text) {
    return text.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

/**
 * Escape text for a Rust `format!` template, where braces are syntax.
 *
 * @param {string} text - Raw text with no placeholder in it.
 * @returns {string} Text whose braces are literal.
 */
export function escapeRustFormat(text) {
    return escapeRustString(text).replaceAll('{', '{{').replaceAll('}', '}}');
}

/**
 * Convert a kind name to its Rust enum variant.
 *
 * @param {string} kind - Kind from the matrix.
 * @returns {string} PascalCase variant name.
 */
function variantName(kind) {
    return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * Render the reason arm for one kind.
 *
 * A reason carrying the placeholder becomes a `format!` with an inline named
 * argument; one without becomes a plain owned string, so the common no-detail
 * arm does not pay for formatting machinery.
 *
 * @param {string} kind - Kind from the matrix.
 * @returns {string} Rust match arm body.
 */
export function renderReasonArm(kind) {
    const { reason } = SZ_FALLBACK_MATRIX[kind];
    const parts = reason.split(SZ_FALLBACK_DETAIL_PLACEHOLDER);
    if (parts.length === 1) {
        return `String::from("${escapeRustString(reason)}")`;
    }
    if (parts.length > 2) {
        throw new Error(
            `[gen-sz-fallback-matrix] kind "${kind}" repeats ${SZ_FALLBACK_DETAIL_PLACEHOLDER}; ` +
                'the Rust renderer emits one inline argument, so a repeat would silently diverge.',
        );
    }
    const template = parts.map(escapeRustFormat).join('{detail}');
    return `format!("${template}")`;
}

/**
 * Render one site's match arm by taking specimens from the TypeScript formatter
 * and splitting them around the parts that vary.
 *
 * Whether the advice depends on the expression kind is DERIVED, not assumed:
 * two specimens with different kinds are compared, and the arm interpolates
 * `sz_fallback_suggestion(kind)` only when they actually differ. Baking in one
 * kind's advice would have shipped the `member` wording for every `szr` kind.
 *
 * @param {string} site - Site name from RUST_SITES.
 * @returns {string} Rust match arm.
 */
export function renderSiteArm(site) {
    const POS = '\u0001POS\u0001';
    const split = kind => {
        const specimen = formatSzFallbackDiagnostic(site, POS, kind);
        const reasonText = describeSzFallback(kind, '').reason;
        const [head, tail] = specimen.split(reasonText);
        if (tail === undefined) {
            throw new Error(`[gen-sz-fallback-matrix] site "${site}" specimen lost its reason`);
        }
        const [before, after] = head.split(POS);
        return { before, after, tail };
    };
    // `member` and `other` carry different matrix suggestions, so a site that
    // forwards the matrix advice shows a different tail for the two.
    const a = split('member');
    const b = split('other');
    if (a.before !== b.before || a.after !== b.after) {
        throw new Error(
            `[gen-sz-fallback-matrix] site "${site}" varies its prefix by kind; the Rust arm renders one template.`,
        );
    }
    const kindDependent = a.tail !== b.tail;
    const tail = kindDependent
        ? a.tail.replace(SZ_FALLBACK_MATRIX.member.suggestion, '\u0002SUG\u0002')
        : a.tail;
    if (kindDependent && !tail.includes('\u0002SUG\u0002')) {
        throw new Error(
            `[gen-sz-fallback-matrix] site "${site}" advice varies by kind but does not contain the matrix suggestion verbatim.`,
        );
    }
    const body =
        escapeRustFormat(a.before) +
        '{position}' +
        escapeRustFormat(a.after) +
        '{reason}' +
        escapeRustFormat(tail).replace('\u0002SUG\u0002', '{suggestion}');
    const prelude = kindDependent
        ? '\n            let suggestion = sz_fallback_suggestion(kind);'
        : '';
    return `        SzFallbackSite::${variantName(site)} => {${prelude}
            format!("${body}")
        }`;
}

/**
 * Render the whole Rust module.
 *
 * @returns {string} Unformatted Rust source.
 */
export function renderRust() {
    const variants = SZ_FALLBACK_KINDS.map(variantName);
    const reasonArms = SZ_FALLBACK_KINDS.map(
        kind => `        SzFallbackKind::${variantName(kind)} => ${renderReasonArm(kind)},`,
    ).join('\n');
    const suggestionArms = SZ_FALLBACK_KINDS.map(
        kind =>
            `        SzFallbackKind::${variantName(kind)} => "${escapeRustString(
                SZ_FALLBACK_MATRIX[kind].suggestion,
            )}",`,
    ).join('\n');

    return `// @generated by scripts/gen-sz-fallback-matrix.mjs
// Do not edit by hand. Edit packages/compiler/src/sz-fallback-matrix.ts instead.
#![allow(dead_code)]
#![allow(clippy::redundant_pub_crate)]

/// Shape of an unresolved sz expression, as far as the guidance is concerned.
///
/// Mirrors \`SzFallbackKind\` in the TypeScript matrix. Each engine classifies
/// its own node type into one of these, so the wording below stays free of any
/// one parser's node vocabulary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SzFallbackKind {
${variants.map(variant => `    ${variant},`).join('\n')}
}

/// Stand-in name for a callee with no statically readable name.
pub(crate) const SZ_FALLBACK_UNKNOWN_CALLEE: &str = "${escapeRustString(
        SZ_FALLBACK_UNKNOWN_CALLEE,
    )}";

/// Why the expression could not be resolved at build time.
///
/// # Arguments
/// * \`kind\` - Classified shape of the expression.
/// * \`detail\` - Callee name, identifier name, or node type. Ignored by kinds
///   whose reason carries no placeholder.
pub(crate) fn sz_fallback_reason(kind: SzFallbackKind, detail: &str) -> String {
    let _ = detail;
    match kind {
${reasonArms}
    }
}

/// What the author should do instead.
///
/// # Arguments
/// * \`kind\` - Classified shape of the expression.
pub(crate) const fn sz_fallback_suggestion(kind: SzFallbackKind) -> &'static str {
    match kind {
${suggestionArms}
    }
}

/// Construct that produced a build-time-unresolvable diagnostic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SzFallbackSite {
${RUST_SITES.map(site => `    ${variantName(site)},`).join('\n')}
}

/// The \`szs\` slot-map diagnostic, matching the TypeScript lanes byte for byte.
///
/// # Arguments
/// * \`filename\` - Source file, as the engine names it.
pub(crate) fn szs_unsupported_diagnostic(filename: &str) -> String {
    format!("${escapeRustFormat(szsUnsupportedDiagnostic('\u0001F\u0001')).replace('\u0001F\u0001', '{filename}')}")
}

/// Render one complete diagnostic line, matching the TypeScript lanes byte for
/// byte (site label, reason, consequence and advice all come from the shared
/// matrix).
///
/// # Arguments
/// * \`site\` - Which construct hit the failure.
/// * \`position\` - \`line:column\`, 1-based.
/// * \`kind\` - Classified shape of the expression.
/// * \`detail\` - Callee name, identifier name, or node type.
pub(crate) fn format_sz_fallback_diagnostic(
    site: SzFallbackSite,
    position: &str,
    kind: SzFallbackKind,
    detail: &str,
) -> String {
    let reason = sz_fallback_reason(kind, detail);
    match site {
${RUST_SITES.map(site => renderSiteArm(site)).join('\n')}
    }
}
`;
}

/**
 * Run rustfmt over generated source so the file matches the repo's Rust style.
 *
 * @param {string} source - Unformatted Rust source.
 * @returns {string} Formatted source, or the input when rustfmt is unavailable.
 */
function formatRust(source) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'csszyx-fallback-matrix-'));
    const file = path.join(dir, 'sz_fallback_matrix.rs');
    try {
        writeFileSync(file, source);
        const result = spawnSync('rustfmt', ['--edition', '2021', file], { encoding: 'utf8' });
        if (result.status !== 0) {
            return source;
        }
        return readFileSync(file, 'utf8');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * Produce the exact bytes the generated file should contain.
 *
 * @returns {string} Formatted Rust source.
 */
export function generateMatrixSource() {
    return formatRust(renderRust());
}

/** Path of the generated Rust module, relative to nothing — absolute. */
export const GENERATED_PATH = outPath;

/**
 * Write the generated module, or verify the committed one is current.
 *
 * @param {boolean} check - When true, report drift instead of writing.
 * @returns {number} Process exit code.
 */
export function main(check) {
    const generated = generateMatrixSource();
    if (check) {
        let current = '';
        try {
            current = readFileSync(outPath, 'utf8');
        } catch {
            current = '';
        }
        if (current !== generated) {
            console.error(
                '[gen-sz-fallback-matrix] generated matrix is stale. Run pnpm gen:sz-fallback-matrix.',
            );
            return 1;
        }
        return 0;
    }
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, generated);
    console.log(`[gen-sz-fallback-matrix] wrote ${path.relative(repoRoot, outPath)}`);
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(main(process.argv.includes('--check')));
}
