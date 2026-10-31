import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const supported = (values, current) => !values || (!values.includes(`!${current}`) && (values.every((v) => v.startsWith('!')) || values.includes(current)));
const detectLibc = (platform) => {
  if (platform !== 'linux') return undefined;
  return process.report?.getReport?.().header?.glibcVersionRuntime ? 'glibc' : 'musl';
};

/** Inspect actual installed versions, not a stamp that can outlive node_modules. */
export function inspectNodeDependencies(
  repo = root,
  platform = process.platform,
  arch = process.arch,
  libc = platform === process.platform ? detectLibc(platform) : undefined,
) {
  const packages = [];
  const problems = [];
  const manifests = ['package.json', 'frontend/dashboard/package.json'];
  const lockPath = resolve(repo, 'package-lock.json');
  if (!existsSync(lockPath)) return { ready: false, packages, problems: ['package-lock.json is missing. Restore it from Git.'], lockValid: false };
  const lock = readJson(lockPath);
  for (const file of manifests) {
    const manifest = readJson(resolve(repo, file));
    const key = file === 'package.json' ? '' : dirname(file).replaceAll('\\', '/');
    for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const entries = Object.entries(manifest[group] ?? {}).sort();
      if (JSON.stringify(entries) !== JSON.stringify(Object.entries(lock.packages?.[key]?.[group] ?? {}).sort())) {
        problems.push(`${file} differs from package-lock.json. Run npm install to update the lockfile before starting.`);
      }
    }
  }
  const lockValid = problems.length === 0;
  for (const [location, expected] of Object.entries(lock.packages ?? {})) {
    if (!location.includes('node_modules/') || !supported(expected.os, platform) || !supported(expected.cpu, arch) || !supported(expected.libc, libc)) continue;
    const file = resolve(repo, location, 'package.json');
    let installed;
    try { installed = readJson(file); } catch { /* Missing or damaged packages need installation. */ }
    const name = expected.name ?? location.split('node_modules/').at(-1);
    const status = !installed ? 'MISSING' : !expected.link && installed.version !== expected.version ? 'WRONG VERSION' : 'OK';
    packages.push({ name, expected: expected.version ?? 'workspace link', installed: installed?.version ?? null, status });
  }
  for (const file of ['node_modules/vite/bin/vite.js', 'node_modules/typescript/bin/tsc', `node_modules/.bin/vite${platform === 'win32' ? '.cmd' : ''}`, `node_modules/.bin/tsc${platform === 'win32' ? '.cmd' : ''}`]) {
    if (!existsSync(resolve(repo, file))) problems.push(`Missing launcher: ${file}`);
  }
  return { ready: lockValid && problems.length === 0 && packages.every((p) => p.status === 'OK'), lockValid, packages, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = inspectNodeDependencies();
    console.log(JSON.stringify(result));
    process.exitCode = result.ready ? 0 : 1;
  } catch {
    console.log(JSON.stringify({ ready: false, lockValid: false, packages: [], problems: ['Cannot read package manifests or lockfile. Restore valid files from Git.'] }));
    process.exitCode = 1;
  }
}
