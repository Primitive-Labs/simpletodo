import { execSync, spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

function runInCwd(command) {
  // Use shell to leverage local node_modules/.bin resolution (concurrently)
  return spawn(command, {
    stdio: "inherit",
    shell: true,
  });
}

function runInDir(cwd, command, extraEnv) {
  return spawn(command, {
    stdio: "inherit",
    shell: true,
    cwd,
    env: { ...process.env, ...(extraEnv || {}) },
  });
}

function parseWorktrees() {
  // Use porcelain format for reliable parsing
  const output = execSync("git worktree list --porcelain", {
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
  const blocks = output.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const entries = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    let fullPath = "";
    let branchRef = "";
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        fullPath = line.slice("worktree ".length).trim();
      } else if (line.startsWith("branch ")) {
        branchRef = line.slice("branch ".length).trim();
      }
    }
    if (!fullPath) continue;
    let branchName = "";
    if (branchRef) {
      // Example: refs/heads/2025-11-10-j88s-x8VEB
      branchName = branchRef.replace(/^refs\/heads\//, "");
    }
    entries.push({ fullPath, branchName });
  }
  return entries;
}

function resolveWorktreeDir(label) {
  const entries = parseWorktrees();
  // 1) Exact branch name match (preferred)
  const exact = entries.find((e) => e.branchName === label);
  if (exact) return exact.fullPath;
  // 2) Match path suffix (e.g., x8VEB)
  const suffix = entries.find((e) => e.fullPath.endsWith(path.sep + label));
  if (suffix) return suffix.fullPath;
  // 3) Partial includes
  const partial = entries.find(
    (e) => e.branchName.includes(label) || e.fullPath.includes(label)
  );
  if (partial) return partial.fullPath;
  return null;
}

function setTerminalTitle(title) {
  if (!title) return;
  if (process.stdout && process.stdout.isTTY) {
    try {
      process.stdout.write(`\x1b]0;${title}\x07`);
    } catch {
      // ignore
    }
  }
}

function main() {
  const label = process.argv[2];
  const command = 'node scripts/dev.mjs';

  if (!label) {
    console.log("[dev-launch] No label provided; starting in current directory.");
    // Set terminal title based on current directory's worktree if possible
    const entries = parseWorktrees();
    const here = process.cwd();
    const entry = entries.find((e) => e.fullPath === here);
    const displayLabel = entry?.branchName || path.basename(here);
    setTerminalTitle(`Worktree: ${displayLabel}`);
    const child = runInCwd(command);
    child.on("exit", (code) => process.exit(code ?? 0));
    return;
  }

  const dir = resolveWorktreeDir(label);
  if (!dir) {
    console.error(
      `[dev-launch] Could not find worktree for label: ${label}. Try an exact branch name from 'git worktree list'.`
    );
    process.exit(1);
  }
  // Derive a friendly label for the terminal title from the resolved worktree
  const entries = parseWorktrees();
  const entry = entries.find((e) => e.fullPath === dir);
  const displayLabel = entry?.branchName || path.basename(dir);
  setTerminalTitle(`Worktree: ${displayLabel}`);
  console.log(`[dev-launch] Starting dev in: ${dir}`);
  const child = runInDir(dir, command, { FORCE_WORKTREE_LABEL: displayLabel });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main();


