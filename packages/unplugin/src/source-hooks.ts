/**
 * What a project's sources select on outside its stylesheets, per file.
 *
 * A merge may remove a class only when no rule selects on it. The style model
 * reads the rules in stylesheets; two more reach the page from sources: an
 * arbitrary variant (`group-[.shadow-md]:p-2`, written in markup or lowered
 * from an `sz` key) and a `<style>` block in a Vue, Svelte or Astro component
 * or an HTML page. This registry keeps what each file contributes, so an edit
 * that removes a hook takes it away again, and hands the model the union. The
 * candidates of files read together in one scan are the exception, kept
 * together (`readTexts`).
 *
 * Only the classes each source names are kept, never its text: the rules are
 * written by the project's own Tailwind (`ProjectStyleModel.variantHooks`), so
 * no second reading of Tailwind's syntax exists here.
 *
 * @module
 */
import { createHash } from 'node:crypto';

import {
    addClassHooks,
    type ClassHooks,
    type ContentFile,
    type ContentScanner,
    noClassHooks,
    styleBlockHooks,
} from '@csszyx/tailwind-oracle';

import type { ProjectStyleModel } from './project-style-model.js';
import { sortStrings } from './sort.js';

/** Files whose `<style>` blocks select on the page's elements. */
export const MARKUP_EXTENSIONS: ReadonlySet<string> = new Set([
    '.vue',
    '.svelte',
    '.astro',
    '.html',
]);

/** One file's text, as `SourceHookRegistry.readTexts` reads it. */
export interface SourceText {
    /** The file, as a stable key. */
    readonly file: string;
    /** Its text. */
    readonly text: string;
    /** Its extension without the dot, as Tailwind's extractor names languages. */
    readonly extension: string;
}

/** Where the candidates of every file read in a batch are kept, together. */
const BATCH_READ = '\0batch-read';

/** What one file contributes. */
interface FileHooks {
    /** Variant-bearing candidates its text holds. */
    written: string[];
    /** Variant-bearing classes its `sz` lowered to. */
    lowered: string[];
    /** What its `<style>` blocks select on. */
    style: ClassHooks;
    /** A digest of the text last read, so reading it again costs a hash. */
    digest?: string;
}

/**
 * Candidates that may carry a variant: a `:` somewhere. The model asks
 * Tailwind which of them do, so this only has to keep none out.
 *
 * @param candidates - Classes as written.
 * @returns The ones with a `:`, sorted and distinct.
 */
function withColon(candidates: Iterable<string>): string[] {
    const kept = new Set<string>();
    for (const candidate of candidates) if (candidate.includes(':')) kept.add(candidate);
    return sortStrings(kept);
}

/**
 * Whether two sorted lists are the same.
 *
 * @param left - One list.
 * @param right - The other.
 * @returns True when equal element by element.
 */
function sameList(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * A stable spelling of what style blocks select on, to compare two readings.
 *
 * @param hooks - The hooks.
 * @returns Their names and matchers, sorted.
 */
function styleKey(hooks: ClassHooks): string {
    return JSON.stringify([
        sortStrings(hooks.names),
        sortStrings(hooks.attributes.map(matcher => JSON.stringify(matcher))),
    ]);
}

/**
 * A digest of a file's text, so reading the same text again costs a hash.
 *
 * @param text - The text.
 * @returns Its SHA-256, base64.
 */
function digestOf(text: string): string {
    return createHash('sha256').update(text).digest('base64');
}

/**
 * What a file's `<style>` blocks select on, when it is markup.
 *
 * @param text - Its text.
 * @param extension - Its extension without the dot.
 * @returns The hooks; none for a file that is not markup.
 */
function styleOf(text: string, extension: string): ClassHooks {
    const style = noClassHooks();
    if (MARKUP_EXTENSIONS.has(`.${extension}`)) styleBlockHooks(text, style);
    return style;
}

/** Every file's contribution, and the union a model is given. */
export class SourceHookRegistry {
    private readonly files = new Map<string, FileHooks>();
    private scanner: ContentScanner | null | undefined;
    /** Per model family, what each candidate's rule selects on. */
    private readonly variantCache = new WeakMap<
        ProjectStyleModel['variantHooks'],
        Map<string, ClassHooks>
    >();

    /**
     * @param loadScanner - Loads Tailwind's extractor, once, on first use.
     */
    constructor(private readonly loadScanner: () => ContentScanner | null) {}

    /**
     * Read one file's text: the candidates Tailwind finds in it, and its
     * `<style>` blocks when it is markup.
     *
     * @param file - The file, as a stable key.
     * @param text - Its text.
     * @param extension - Its extension without the dot, as Tailwind's
     *        extractor names languages.
     * @returns True when what the file contributes changed.
     */
    readText(file: string, text: string, extension: string): boolean {
        // The transform reads the text the prescan already read: 0.55 ms a
        // file to scan on the docs app, against a hash.
        const digest = digestOf(text);
        if (this.files.get(file)?.digest === digest) return false;
        return this.update(file, {
            written: withColon(this.scan([{ content: text, extension }])),
            style: styleOf(text, extension),
            digest,
        });
    }

    /**
     * Read many files' text with one scan: what `readText` reads in each, for
     * all of them at once.
     *
     * Tailwind's extractor answers a list of files with one list, and asking
     * it file by file cost 1864 ms against 68 ms on a 4,700-file project. So
     * the candidates of a batch are kept together rather than per file, and
     * only grow: a file read again on its own later keeps what the batch found
     * in it until the registry is rebuilt, as Tailwind's own dev server keeps
     * every candidate it has seen. That keeps a class, never drops one.
     *
     * @param texts - The files.
     * @returns True when what the files contribute changed.
     */
    readTexts(texts: Iterable<SourceText>): boolean {
        const unread: Array<SourceText & { digest: string }> = [];
        for (const entry of texts) {
            const digest = digestOf(entry.text);
            if (this.files.get(entry.file)?.digest !== digest) unread.push({ ...entry, digest });
        }
        if (unread.length === 0) return false;
        let changed = false;
        for (const { file, text, extension, digest } of unread) {
            changed =
                this.update(file, { written: [], style: styleOf(text, extension), digest }) ||
                changed;
        }
        const found = this.scan(
            unread.map(({ text, extension }) => ({ content: text, extension })),
        );
        const written = withColon([...(this.files.get(BATCH_READ)?.written ?? []), ...found]);
        return this.update(BATCH_READ, { written }) || changed;
    }

    /**
     * Every candidate the files hold, by Tailwind's extractor when the project
     * has one.
     *
     * @param files - The texts.
     * @returns Their candidates, together.
     */
    private scan(files: readonly ContentFile[]): string[] {
        this.scanner ??= this.loadScanner();
        return this.scanner === null
            ? // Without Tailwind's extractor, every quoted or spaced token
              // is a candidate: too many only keeps classes.
              files.flatMap(({ content }) => content.split(/[\s"'`]+/))
            : this.scanner(files);
    }

    /**
     * Record candidates found without a file to read: Tailwind's own scan of
     * the sources its stylesheets name, which reaches files the project walk
     * does not.
     *
     * @param key - A stable key for this list.
     * @param candidates - Classes as written.
     * @returns True when the list changed.
     */
    readCandidates(key: string, candidates: Iterable<string>): boolean {
        return this.update(key, { written: withColon(candidates) });
    }

    /**
     * Record the classes a file's `sz` lowered to.
     *
     * @param file - The file, as a stable key.
     * @param classes - What its first pass emitted.
     * @returns True when what the file contributes changed.
     */
    readLowered(file: string, classes: Iterable<string>): boolean {
        return this.update(file, { lowered: withColon(classes) });
    }

    /**
     * Everything the sources select on, as the given model's Tailwind writes
     * their rules.
     *
     * @param model - The style model.
     * @returns The hooks to hand `model.withSourceHooks`.
     */
    hooksFor(model: ProjectStyleModel): ClassHooks {
        let cache = this.variantCache.get(model.variantHooks);
        if (cache === undefined) {
            cache = new Map();
            this.variantCache.set(model.variantHooks, cache);
        }
        const hooks = noClassHooks();
        const unknown = new Set<string>();
        for (const entry of this.files.values()) {
            addClassHooks(hooks, entry.style);
            for (const candidate of [...entry.written, ...entry.lowered]) {
                if (!cache.has(candidate)) unknown.add(candidate);
            }
        }
        for (const candidate of unknown) cache.set(candidate, model.variantHooks([candidate]));
        const asked = new Set<string>();
        for (const entry of this.files.values()) {
            for (const candidate of [...entry.written, ...entry.lowered]) {
                if (asked.has(candidate)) continue;
                asked.add(candidate);
                addClassHooks(hooks, cache.get(candidate) as ClassHooks);
            }
        }
        return hooks;
    }

    /**
     * Replace part of a file's contribution.
     *
     * @param file - The file.
     * @param next - The parts read again.
     * @returns True when anything changed.
     */
    private update(file: string, next: Partial<FileHooks>): boolean {
        const previous = this.files.get(file) ?? {
            written: [],
            lowered: [],
            style: noClassHooks(),
        };
        const merged: FileHooks = { ...previous, ...next };
        this.files.set(file, merged);
        return !(
            sameList(previous.written, merged.written) &&
            sameList(previous.lowered, merged.lowered) &&
            styleKey(previous.style) === styleKey(merged.style)
        );
    }
}
