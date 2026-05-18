#!/usr/bin/env node
// Verify the dormant NAPI/native feature without linking a standalone Rust
// test binary. The napi crate expects Node-provided symbols at addon load time;
// `cargo test --features native` links outside that context and fails for the
// wrong reason.

import { spawnSync } from "node:child_process";

const COMMANDS = [
  ["cargo", ["check", "--manifest-path", "Cargo.toml", "--features", "native"]],
  [
    "cargo",
    [
      "clippy",
      "--manifest-path",
      "Cargo.toml",
      "--all-targets",
      "--features",
      "native",
      "--",
      "-D",
      "warnings",
    ],
  ],
];

for (const [command, args] of COMMANDS) {
  const result = spawnSync(command, args, { stdio: "inherit" });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
