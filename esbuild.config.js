const esbuild = require('esbuild');
const path = require('path');

async function build() {
  // Build service worker (supports ES modules)
  await esbuild.build({
    entryPoints: ['src/background/serviceWorker.ts'],
    bundle: true,
    outfile: 'dist/background/serviceWorker.js',
    platform: 'browser',
    target: 'chrome96',
    format: 'esm',
    sourcemap: true,
    minify: false,
    external: [],
  });

  // Build content script (needs to be bundled without ES modules)
  await esbuild.build({
    entryPoints: ['src/content/contentScript.ts'],
    bundle: true,
    outfile: 'dist/content/contentScript.js',
    platform: 'browser',
    target: 'chrome96',
    format: 'iife',
    sourcemap: true,
    minify: false,
    external: [],
  });

  // Build popup script
  await esbuild.build({
    entryPoints: ['src/popup/popup.ts'],
    bundle: true,
    outfile: 'dist/popup/popup.js',
    platform: 'browser',
    target: 'chrome96',
    format: 'esm',
    sourcemap: true,
    minify: false,
    external: [],
  });

  console.log('✅ All scripts bundled successfully');
}

if (require.main === module) {
  build().catch(console.error);
}

module.exports = { build };