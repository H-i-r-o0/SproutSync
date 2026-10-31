import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectNodeDependencies } from './check-node-dependencies.mjs';

const scratch = fileURLToPath(new URL('../.tools/', import.meta.url));
function fixture(t) {
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(resolve(scratch, 'dependency-check-'));
  const write = (file, data) => {
    const path = resolve(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data));
  };
  t.after(() => {
    const child = relative(resolve(scratch), resolve(root));
    assert(child && !child.startsWith('..') && !isAbsolute(child));
    rmSync(root, { recursive: true, force: true });
  });
  write('package.json', { name: 'fixture' });
  write('frontend/dashboard/package.json', { dependencies: { example: '^1.0.0' } });
  const lock = { packages: {
    '': {},
    'frontend/dashboard': { dependencies: { example: '^1.0.0' } },
    'node_modules/example': { version: '1.2.0' },
    'node_modules/linux-only': { version: '1.0.0', optional: true, os: ['linux'] },
    'node_modules/linux-glibc': { version: '1.0.0', optional: true, os: ['linux'], libc: ['glibc'] },
    'node_modules/linux-musl': { version: '1.0.0', optional: true, os: ['linux'], libc: ['musl'] },
  } };
  write('package-lock.json', lock);
  write('node_modules/example/package.json', { name: 'example', version: '1.2.0' });
  write('node_modules/linux-only/package.json', { name: 'linux-only', version: '1.0.0' });
  write('node_modules/linux-glibc/package.json', { name: 'linux-glibc', version: '1.0.0' });
  for (const file of [
    'node_modules/vite/bin/vite.js',
    'node_modules/typescript/bin/tsc',
    'node_modules/.bin/vite',
    'node_modules/.bin/tsc',
    'node_modules/.bin/vite.cmd',
    'node_modules/.bin/tsc.cmd',
  ]) write(file, 'fixture');
  return { root, write, lock };
}
test('a complete installation is reused without requiring other platforms optional packages', (t) => {
  const f = fixture(t);
  const result = inspectNodeDependencies(f.root, 'win32', 'x64');
  assert.equal(result.ready, true);
  assert.equal(result.packages.length, 1);
});
test('a glibc Linux installation does not require musl-only optional packages', (t) => {
  const f = fixture(t);
  const result = inspectNodeDependencies(f.root, 'linux', 'x64', 'glibc');
  assert.equal(result.ready, true);
  assert.deepEqual(result.packages.map((item) => item.name).sort(), [
    'example',
    'linux-glibc',
    'linux-only',
  ]);
});
test('detects a deleted package even though other node_modules files remain', (t) => {
  const f = fixture(t);
  unlinkSync(resolve(f.root, 'node_modules/example/package.json'));
  const result = inspectNodeDependencies(f.root, 'win32', 'x64');
  assert.equal(result.ready, false);
  assert.equal(result.packages[0].status, 'MISSING');
});
test('a changed lockfile requires the newly locked version', (t) => {
  const f = fixture(t);
  f.lock.packages['node_modules/example'].version = '1.3.0';
  f.write('package-lock.json', f.lock);
  const result = inspectNodeDependencies(f.root, 'win32', 'x64');
  assert.equal(result.ready, false);
  assert.equal(result.packages[0].status, 'WRONG VERSION');
});
test('an out-of-date lockfile explains recovery instead of reinstalling an incompatible tree', (t) => {
  const f = fixture(t);
  f.write('frontend/dashboard/package.json', { dependencies: { example: '^2.0.0' } });
  const result = inspectNodeDependencies(f.root, 'win32', 'x64');
  assert.equal(result.lockValid, false);
  assert.match(result.problems.join(), /npm install/);
});
test('missing executable links are reported even if versions match', (t) => {
  const f = fixture(t);
  unlinkSync(resolve(f.root, 'node_modules/.bin/vite.cmd'));
  const result = inspectNodeDependencies(f.root, 'win32', 'x64');
  assert.equal(result.ready, false);
  assert.match(result.problems.join(), /Missing launcher/);
});
