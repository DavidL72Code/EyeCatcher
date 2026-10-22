// npm run vendor: copies the libraries the page runs into vendor/, from the exact versions in package.json, with
// their licenses, and records each file's SHA-256 in vendor/manifest.json. The app loads them from here, never from a
// CDN, so no code from outside the app runs in it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = path.join(root, 'vendor');
const pkg = (name) => JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
const LIBS = [
  { name: 'mediabunny', file: 'dist/bundles/mediabunny.min.mjs', as: 'mediabunny.min.mjs', license: 'LICENSE', use: 'decodes and encodes video (video.js)' },
  { name: 'motion', file: 'dist/motion.js', as: 'motion.js', license: 'LICENSE.md', use: "Home's animations (motion.dev), as window.Motion" },
  { name: 'chess.js', file: 'dist/esm/chess.js', as: 'chess.js', license: 'LICENSE', use: 'chess rules for reading moves (chess-reader.js)' },
  // Stockfish is GPL-3.0: it ships here unchanged, as its own program in a worker, with its license; its source is at
  // https://github.com/nmrugg/stockfish.js/tree/v10.0.2
  { name: 'stockfish', file: 'src/stockfish.asm.js', as: 'stockfish.asm.js', license: 'Copying.txt', use: 'the chess engine, run in a Web Worker (chess-reader.js)' },
];

const want = createRequire(import.meta.url)('../package.json').devDependencies;
fs.mkdirSync(out, { recursive: true });
const manifest = {};
for (const lib of LIBS) {
  const { version, license } = pkg(lib.name);
  if (want[lib.name] !== version) throw new Error(`${lib.name} is ${version} in node_modules but ${want[lib.name]} in package.json. Run npm install.`);
  const src = path.join(root, 'node_modules', lib.name);
  fs.copyFileSync(path.join(src, lib.file), path.join(out, lib.as));
  fs.copyFileSync(path.join(src, lib.license), path.join(out, `${lib.name}.LICENSE.txt`));
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(out, lib.as))).digest('hex');
  manifest[lib.as] = { package: lib.name, version, license, from: lib.file, sha256, use: lib.use };
  console.log(`${lib.as}  ${lib.name}@${version}  ${license}  sha256 ${sha256.slice(0, 16)}…`);
}
fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
