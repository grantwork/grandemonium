#!/usr/bin/env node
/**
 * Copies the built plugin into every Obsidian vault listed in vaults.json.
 *
 * Usage:
 *   node scripts/install-to-vault.mjs                 install to every registered vault
 *   node scripts/install-to-vault.mjs /path/to/vault  install to explicit paths instead
 *
 * Run `npm run build` first. `npm run deploy` does both.
 */

import { existsSync, mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTER = join(ROOT, 'vaults.json');
const ARTIFACTS = ['main.js', 'styles.css', 'manifest.json'];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readPluginId() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  if (!manifest.id) fail('manifest.json has no id.');
  return manifest.id;
}

export function readVaultRegister(registerPath = REGISTER) {
  if (!existsSync(registerPath)) return [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(registerPath, 'utf8'));
  } catch (error) {
    fail(`Could not parse ${registerPath}: ${error.message}`);
  }
  if (!Array.isArray(parsed.vaults)) fail(`${registerPath} must contain a "vaults" array.`);
  return parsed.vaults.map((entry, index) => {
    if (typeof entry === 'string') return { name: entry, path: entry };
    if (!entry || typeof entry.path !== 'string') {
      fail(`${registerPath}: vaults[${index}] needs a "path" string.`);
    }
    return { name: entry.name ?? entry.path, path: entry.path };
  });
}

function installTo(vault, pluginId) {
  if (!existsSync(join(vault.path, '.obsidian'))) {
    console.warn(`  skipped ${vault.name}: no .obsidian folder at ${vault.path}`);
    return false;
  }
  const dest = join(vault.path, '.obsidian', 'plugins', pluginId);
  mkdirSync(dest, { recursive: true });
  for (const artifact of ARTIFACTS) copyFileSync(join(ROOT, artifact), join(dest, artifact));
  console.log(`  installed ${vault.name} -> ${dest}`);
  return true;
}

function main() {
  for (const artifact of ARTIFACTS) {
    if (!existsSync(join(ROOT, artifact))) fail(`Missing ${artifact}. Run: npm run build`);
  }

  const explicit = process.argv.slice(2);
  const vaults = explicit.length > 0
    ? explicit.map(path => ({ name: path, path: resolve(path) }))
    : readVaultRegister();

  if (vaults.length === 0) fail(`No vaults registered. Add one to ${REGISTER}.`);

  const pluginId = readPluginId();
  console.log(`Installing ${pluginId} to ${vaults.length} vault(s):`);
  const installed = vaults.filter(vault => installTo(vault, pluginId)).length;
  if (installed === 0) fail('No vaults were updated.');
  console.log(`Done. Reload Obsidian to pick up the change.`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
