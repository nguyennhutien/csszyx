/**
 * SSR detection helper.
 * Used to guard CSSOM operations that are unavailable in Node.js.
 */
export const isServer: boolean = typeof document === 'undefined';
