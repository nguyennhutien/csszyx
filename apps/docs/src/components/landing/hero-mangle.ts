/**
 * The mangled form the landing hero shows for a class list, as the build's
 * mangler writes one: each class becomes its own token, and the same class is
 * the same token wherever it appears.
 *
 * @param classList - The classes, joined with a space.
 * @param cache - Class to token, shared across every example the hero shows.
 * @param next - Hands out the next unused token.
 * @returns One token per class, joined with a space.
 */
export function mangledClassList(
    classList: string,
    cache: Map<string, string>,
    next: () => string,
): string {
    return classList
        .split(' ')
        .filter(Boolean)
        .map(className => {
            let token = cache.get(className);
            if (token === undefined) {
                token = next();
                cache.set(className, token);
            }
            return token;
        })
        .join(' ');
}
