/**
 * Test runner: bundles the TypeScript suites with esbuild (already present via
 * Vite) and executes them on Node.
 *
 *   npm test
 */
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const tmp = (name) => path.join(root, `.test-${name}.cjs`);

const suites = [
  ['simulation & AI', 'scripts/smoke.ts', '--alias:@=./src'],
  ['react render', 'scripts/render.tsx', '--alias:@=./src', '--jsx=automatic'],
];

let failed = 0;
for (const [label, entry, ...flags] of suites) {
  const out = tmp(label.replace(/\W+/g, '-'));
  console.log(`\n>>> ${label}`);
  try {
    execFileSync('npx', ['esbuild', entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`, '--log-level=warning', ...flags], {
      stdio: 'inherit',
      cwd: root,
    });
    execFileSync('node', [out], { stdio: 'inherit', cwd: root });
  } catch {
    failed++;
    console.log(`    ^ ${label} suite failed`);
  } finally {
    rmSync(out, { force: true });
  }
}

console.log(`\n${failed === 0 ? 'All suites passed.' : `${failed} suite(s) failed.`}\n`);
process.exit(failed === 0 ? 0 : 1);
