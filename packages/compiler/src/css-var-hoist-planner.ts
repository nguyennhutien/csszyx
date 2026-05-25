/**
 *
 */
export interface CSSVariableHoistNode {
    /** Stable element id. */
    id: string;
    /** Parent element id; null/undefined marks the root. */
    parentId?: string | null;
    /** Whether this element can receive hoisted style props. */
    canHost?: boolean;
}

/**
 *
 */
export interface CSSVariableHoistUsage {
    /** Stable usage id returned to callers in a hoist group. */
    id: string;
    /** Element that currently owns the variable. */
    elementId: string;
    /** CSS custom property name. */
    name: string;
    /** Comparable value identity. Dynamic or unknown values should not be passed. */
    valueKey: string;
}

/**
 *
 */
export interface CSSVariableHoistPlan {
    /** CSS custom property name to hoist. */
    name: string;
    /** Comparable value identity shared by every usage in this group. */
    valueKey: string;
    /** Lowest common ancestor that should receive the variable. */
    targetElementId: string;
    /** Usages that can remove their local declaration after hoisting. */
    usageIds: string[];
}

/**
 *
 */
export interface CSSVariableHoistOptions {
    /** Maximum cascade distance from hoist target to any usage. */
    maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 5;

/**
 * Plans component-tier CSS variable hoists without mutating source.
 *
 * Only identical name/value pairs are considered. A group is skipped when the
 * lowest common ancestor cannot host style props or any usage is farther than
 * the configured max depth.
 *
 * @param nodes Element tree nodes.
 * @param usages Comparable component-tier CSS variable usages.
 * @param options Hoisting options.
 * @returns Hoist plans in first-usage order.
 */
export function planComponentVariableHoists(
    nodes: readonly CSSVariableHoistNode[],
    usages: readonly CSSVariableHoistUsage[],
    options: CSSVariableHoistOptions = {},
): CSSVariableHoistPlan[] {
    const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    const groups = new Map<string, CSSVariableHoistUsage[]>();

    for (const usage of usages) {
        const groupKey = `${usage.name}\0${usage.valueKey}`;
        const group = groups.get(groupKey);
        if (group) {
            group.push(usage);
        } else {
            groups.set(groupKey, [usage]);
        }
    }

    const plans: CSSVariableHoistPlan[] = [];
    for (const group of groups.values()) {
        if (group.length < 2) {
            continue;
        }
        const targetElementId = findLowestCommonAncestor(
            group.map(usage => usage.elementId),
            nodeById,
        );
        if (!targetElementId) {
            continue;
        }
        const target = nodeById.get(targetElementId);
        if (!target || target.canHost === false) {
            continue;
        }
        if (
            group.some(
                usage => distanceToAncestor(usage.elementId, targetElementId, nodeById) > maxDepth,
            )
        ) {
            continue;
        }
        plans.push({
            name: group[0].name,
            valueKey: group[0].valueKey,
            targetElementId,
            usageIds: group.map(usage => usage.id),
        });
    }

    return plans;
}

/**
 * Finds the shared lowest ancestor for a list of element ids.
 *
 * @param elementIds Element ids to compare.
 * @param nodeById Tree lookup.
 * @returns Lowest common ancestor id, or null when no shared host exists.
 */
function findLowestCommonAncestor(
    elementIds: readonly string[],
    nodeById: ReadonlyMap<string, CSSVariableHoistNode>,
): string | null {
    const [first, ...rest] = elementIds;
    if (!first) {
        return null;
    }
    let currentAncestors = ancestorChain(first, nodeById);
    for (const elementId of rest) {
        const nextAncestors = new Set(ancestorChain(elementId, nodeById));
        currentAncestors = currentAncestors.filter(id => nextAncestors.has(id));
        if (currentAncestors.length === 0) {
            return null;
        }
    }
    return currentAncestors[0] ?? null;
}

/**
 * Builds an element-to-root ancestor chain including the element itself.
 *
 * @param elementId Starting element id.
 * @param nodeById Tree lookup.
 * @returns Ancestor ids from closest to farthest.
 */
function ancestorChain(
    elementId: string,
    nodeById: ReadonlyMap<string, CSSVariableHoistNode>,
): string[] {
    const chain: string[] = [];
    let current: string | null | undefined = elementId;
    while (current) {
        const node = nodeById.get(current);
        if (!node) {
            break;
        }
        chain.push(current);
        current = node.parentId;
    }
    return chain;
}

/**
 * Counts edges from an element to one of its ancestors.
 *
 * @param elementId Starting element id.
 * @param ancestorId Ancestor id to find.
 * @param nodeById Tree lookup.
 * @returns Edge count, or Infinity when the ancestor is not reachable.
 */
function distanceToAncestor(
    elementId: string,
    ancestorId: string,
    nodeById: ReadonlyMap<string, CSSVariableHoistNode>,
): number {
    let distance = 0;
    let current: string | null | undefined = elementId;
    while (current) {
        if (current === ancestorId) {
            return distance;
        }
        const node = nodeById.get(current);
        if (!node) {
            break;
        }
        current = node.parentId;
        distance++;
    }
    return Number.POSITIVE_INFINITY;
}
