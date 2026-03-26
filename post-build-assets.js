/**
 * Copies all non-TypeScript static assets from app/ to dist/app/
 * after `tsc` compiles the source. Handles any future asset types
 * (templates, locales, images, etc.) without needing script updates.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, './app');
const DEST = path.resolve(__dirname, './dist/app');

const SKIP_EXTENSIONS = new Set(['.ts']);

function copyAssets(src, dest) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyAssets(srcPath, destPath);
    } else if (!SKIP_EXTENSIONS.has(path.extname(entry.name))) {
      fs.mkdirSync(dest, { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyAssets(SRC, DEST);
console.log('Static assets copied to dist/app/');
