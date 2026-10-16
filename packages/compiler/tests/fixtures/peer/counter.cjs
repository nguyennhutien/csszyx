// Counts how many times it is evaluated.
globalThis.__peerLoads = (globalThis.__peerLoads ?? 0) + 1;
module.exports = { loads: globalThis.__peerLoads };
