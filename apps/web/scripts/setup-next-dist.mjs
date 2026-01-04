import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removeIfExists(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function isJunctionOrSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function main() {
  if (process.platform !== 'win32') return;

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return;

  // Next's dist output is configured via next.config.js to write to:
  //   %LOCALAPPDATA%\medi-web-next\dist
  // We avoid creating a `.next` junction inside the OneDrive workspace because
  // Windows/OneDrive can throw transient UNKNOWN fs errors when reading files
  // through reparse points.
  const distRoot = path.join(localAppData, 'medi-web-next');
  const distDir = path.join(distRoot, 'dist');
  const distNodeModules = path.join(distRoot, 'node_modules');
  const webNext = path.join(process.cwd(), '.next');
  const webNodeModules = path.join(process.cwd(), 'node_modules');
  const rootNodeModules = path.join(process.cwd(), '..', '..', 'node_modules');
  const runtimeNodeModules = path.join(localAppData, 'medi-web-runtime', 'node_modules');

  ensureDir(distRoot);
  ensureDir(distDir);

  // If an old `.next` junction exists from earlier mitigation, remove it so Next
  // uses the configured distDir (LOCALAPPDATA) without touching OneDrive.
  if (fs.existsSync(webNext) && isJunctionOrSymlink(webNext)) {
    removeIfExists(webNext);
  }

  // Next's compiled server output lives under LOCALAPPDATA; at runtime it resolves
  // dependencies by walking up for `node_modules`. Ensure the dist output has access
  // to a real `node_modules` tree.
  const candidates = [runtimeNodeModules, webNodeModules, rootNodeModules];
  const nodeModulesSource = candidates.find((candidate) => {
    if (!fs.existsSync(candidate)) return false;
    // Verify it's a usable install (must have next + react).
    return (
      fs.existsSync(path.join(candidate, 'next', 'package.json')) &&
      fs.existsSync(path.join(candidate, 'react', 'package.json'))
    );
  });

  if (!nodeModulesSource) {
    console.warn(
      '[setup-next-dist] Could not find a usable node_modules (checked apps/web and repo root). Run `npm install` at the repo root.'
    );
    return;
  }

  // If dist node_modules exists but is wrong, replace it.
  if (fs.existsSync(distNodeModules)) {
    // If it's already a junction/symlink, leave it (assume correct).
    if (isJunctionOrSymlink(distNodeModules)) return;

    // If it's a real directory (e.g., stale), remove it.
    removeIfExists(distNodeModules);
  }

  // Create a junction so runtime requires resolve from dist output.
  fs.symlinkSync(nodeModulesSource, distNodeModules, 'junction');
}

main();
