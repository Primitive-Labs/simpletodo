import { execSync, spawn } from "node:child_process";
import { basename } from "node:path";
import process from "node:process";

function safe(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function computeLabel() {
  // Explicit override from launcher (when user passed a worktree label)
  if (process.env.FORCE_WORKTREE_LABEL) return process.env.FORCE_WORKTREE_LABEL;

  // Only auto-label if this directory is a linked worktree (not the primary repo)
  // Heuristic: git dir path contains "/worktrees/"
  const gitDir = safe("git rev-parse --git-dir");
  const isLinkedWorktree = gitDir.includes("/worktrees/");
  if (!isLinkedWorktree) return "";

  // Prefer the current branch name when available (e.g., 2025-11-10-j88s-x8VEB)
  const branch = safe("git rev-parse --abbrev-ref HEAD");
  if (branch && branch !== "HEAD") {
    return branch;
  }

  const toplevel = safe("git rev-parse --show-toplevel");
  if (toplevel) return basename(toplevel);

  const shortSha = safe("git rev-parse --short HEAD");
  if (branch || shortSha) return [branch, shortSha].filter(Boolean).join("@");

  return "unknown-worktree";
}

const label = computeLabel();
if (label && label.trim().length > 0) {
  process.env.VITE_WORKTREE_LABEL = label;
  console.log(`[dev] VITE_WORKTREE_LABEL=${process.env.VITE_WORKTREE_LABEL}`);
} else {
  // Ensure it doesn't leak from parent env
  delete process.env.VITE_WORKTREE_LABEL;
}

const child = spawn("pnpm", ["vite"], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});
child.on("exit", (code) => process.exit(code ?? 0));
