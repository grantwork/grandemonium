import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const bundleCriticalRuntimeDependencies = Object.freeze([
  '@anthropic-ai/claude-agent-sdk',
  'smol-toml',
]);

const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function inspectRuntimeDependencyParity({ packageJson, packageLock }) {
  const violations = [];
  const lockManifest = packageLock.packages?.['']?.dependencies;

  for (const dependency of bundleCriticalRuntimeDependencies) {
    const expected = packageJson.dependencies?.[dependency];
    if (typeof expected !== 'string' || !exactVersionPattern.test(expected)) {
      violations.push({
        actual: expected,
        dependency,
        expected: 'an exact version',
        source: 'package.json',
      });
      continue;
    }
    const manifestActual = lockManifest?.[dependency];
    if (manifestActual !== expected) {
      violations.push({ actual: manifestActual, dependency, expected, source: 'package-lock.json manifest' });
    }

    const npmActual = packageLock.packages?.[`node_modules/${dependency}`]?.version;
    if (npmActual !== expected) {
      violations.push({
        actual: npmActual,
        dependency,
        expected,
        source: 'package-lock.json resolution',
      });
    }
  }

  return violations;
}

export function assertRuntimeDependencyParity(root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)) {
  const violations = inspectRuntimeDependencyParity({
    packageJson: readJson(path.join(root, 'package.json')),
    packageLock: readJson(path.join(root, 'package-lock.json')),
  });
  if (violations.length === 0) return;

  const details = violations.map(violation => (
    `${violation.source}: ${violation.dependency} expected ${violation.expected}, `
    + `found ${violation.actual ?? 'missing'}`
  ));
  throw new Error(`Bundle-critical runtime dependency parity failed:\n- ${details.join('\n- ')}`);
}
