#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  console.log(`Copied: ${src} -> ${dest}`);
}

function copyAssets() {
  console.log('Copying assets...');

  // Ensure dist directories exist
  ensureDir('dist/popup');

  // Copy HTML and CSS files to the correct locations
  copyFile('src/popup/popup.html', 'dist/popup/popup.html');
  copyFile('src/popup/popup.css', 'dist/popup/popup.css');
  copyFile('manifest.json', 'dist/manifest.json');

  // Fix manifest paths for extension loading
  fixManifestPaths();

  console.log('Assets copied successfully!');
}

function fixManifestPaths() {
  const manifestPath = 'dist/manifest.json';
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // Fix paths to be relative to dist folder
  manifest.side_panel.default_path = 'popup/popup.html';
  manifest.background.service_worker = 'background/serviceWorker.js';
  manifest.background.type = 'module'; // Service workers support ES modules
  manifest.content_scripts[0].js = ['content/contentScript.js'];
  // Content scripts will be bundled as IIFE, no module type needed
  manifest.web_accessible_resources[0].resources = ['shared/*'];

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('Fixed manifest paths and module types');
}


// Run if called directly
if (require.main === module) {
  copyAssets();
}

module.exports = { copyAssets, ensureDir, copyFile };