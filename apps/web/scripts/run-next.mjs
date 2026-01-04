import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function main() {
  if (process.platform !== 'win32') {
    fail('[run-next] This wrapper is intended for Windows.');
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    fail('[run-next] LOCALAPPDATA is not set.');
  }

  const runtimeDir = path.join(localAppData, 'medi-web-runtime');
  const nextBin = path.join(runtimeDir, 'node_modules', 'next', 'dist', 'bin', 'next');

  if (!fs.existsSync(nextBin)) {
    fail(
      `[run-next] Missing Next runtime at ${nextBin}.\n` +
        `Run: npm run setup:runtime (in apps/web)\n`
    );
  }

  const args = process.argv.slice(2);
  if (args.length === 0) {
    fail('[run-next] Missing args. Example: node ./scripts/run-next.mjs dev -p 3000');
  }

  const child = spawn(process.execPath, [nextBin, ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED ?? '1'
    }
  });

  child.on('exit', (code) => process.exit(code ?? 1));
}

main();
