import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { build, stop } from 'esbuild';

import * as compressedStaticAssetsHelpers from '../../../scripts/compressedStaticAssets.js';

const { createCompressedStaticAssetsPlugin } = compressedStaticAssetsHelpers;

const root = path.resolve(__dirname, '../../..');

describe('compressed static assets', () => {
  const tempDirectory = mkdtempSync(path.join(tmpdir(), 'grandemonium-static-assets-'));
  const bundlePath = path.join(tempDirectory, 'static-assets.cjs');
  let bundleContributors: string[] = [];

  beforeAll(async () => {
    const result = await build({
      absWorkingDir: root,
      bundle: true,
      external: [
        ...builtinModules,
        ...builtinModules.map(moduleName => `node:${moduleName}`),
      ],
      format: 'cjs',
      logLevel: 'silent',
      metafile: true,
      outfile: bundlePath,
      platform: 'browser',
      plugins: [createCompressedStaticAssetsPlugin()],
      stdin: {
        contents: `
          import * as english from './src/i18n/locales/en.json';
          import * as german from './src/i18n/locales/de.json';
          import * as french from './src/i18n/locales/fr.json';

          export function probeLocale() {
            return [
              english.settings.hiddenSlashCommands.name,
              german.common.save,
              french.common.save.length > 0,
            ];
          }
        `,
        loader: 'ts',
        resolveDir: root,
        sourcefile: 'compressed-static-assets.ts',
      },
      target: 'es2022',
    });
    bundleContributors = Object.entries(Object.values(result.metafile.outputs)[0].inputs)
      .filter(([, contribution]) => contribution.bytesInOutput > 0)
      .map(([input]) => input);
  }, 60_000);

  afterAll(() => {
    stop();
    rmSync(tempDirectory, { force: true, recursive: true });
  });

  it('Brotli-compresses locale payloads without changing them', () => {
    const bundle = readFileSync(bundlePath, 'utf8');
    const result = spawnSync(
      process.execPath,
      ['-e', 'process.stdout.write(JSON.stringify(require(process.argv[1]).probeLocale()));', bundlePath],
      { cwd: tempDirectory, encoding: 'utf8', timeout: 30_000 },
    );
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);

    expect(bundle).toContain('brotliDecompressSync');
    expect(bundle).not.toContain('Hidden Commands and Skills');
    expect(JSON.parse(result.stdout.trim())).toEqual([
      'Hidden Commands and Skills',
      'Speichern',
      true,
    ]);
  });

  it('shares one compressed catalog across non-English locales', () => {
    const compressedCatalogContributors = bundleContributors.filter(input => (
      input.includes('compressed-locale-catalog')
    ));

    expect(compressedCatalogContributors).toEqual([
      'compressed-locale-catalog:non-english',
    ]);
  });
});
