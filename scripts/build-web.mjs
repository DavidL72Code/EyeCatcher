// The website copy of Eye Catcher, for GitHub Pages or any static host: the page and what it loads, copied to site/.
// No server is behind it, so there's no .env and no key in it: env.js is empty, and each player pastes their own key,
// which their browser keeps and sends only to Google. The critique speaks with the browser's own voices (the desktop
// app's Kokoro voice needs its local server). The dev server's Content-Security-Policy keeps the page to itself,
// Google's model API and Google's fonts.
//   node scripts/build-web.mjs [out=site]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { policy } from './dev.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = path.resolve(root, process.argv[2] || 'site');

// the dev server's policy, as a meta tag: a static host sends no headers. frame-ancestors only works as a header
const CSP = policy({}).split('; ').filter((d) => !d.startsWith('frame-ancestors')).join('; ');

// the page's own files: its scripts are the ones index.html names (env.js is made here, never copied)
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((s) => s !== 'env.js');
const files = ['index.html', 'styles.css', ...scripts];
const dirs = ['vendor'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of files) {
  if (!fs.existsSync(path.join(root, f))) throw new Error(`build-web: index.html loads ${f}, which isn't here`);
  fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
  fs.copyFileSync(path.join(root, f), path.join(out, f));
}
for (const d of dirs) fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true });

const page = html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n  <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n  <meta name="referrer" content="no-referrer" />`);
if (page === html) throw new Error("build-web: couldn't place the Content-Security-Policy in index.html");
fs.writeFileSync(path.join(out, 'index.html'), page);
fs.writeFileSync(path.join(out, 'env.js'), '/* The website copy: no key ships with it. Each player pastes their own. */\nwindow.__ENV__ = Object.freeze({});\n');
// GitHub Pages serves the files as they are, without Jekyll
fs.writeFileSync(path.join(out, '.nojekyll'), '');

// nothing private or secret may leave with it
const all = fs.readdirSync(out, { recursive: true }).map(String);
const bad = all.filter((f) => /(^|\/)(\.env|eval|tests|assets|voice-samples)(\/|$|\.)|\.(mp4|mov|webm|mkv|wav)$/i.test(f));
if (bad.length) throw new Error(`build-web: must not ship ${bad.join(', ')}`);
const keyish = all.filter((f) => !fs.statSync(path.join(out, f)).isDirectory()).filter((f) => /AIza[0-9A-Za-z_-]{30,}/.test(fs.readFileSync(path.join(out, f), 'utf8')));
if (keyish.length) throw new Error(`build-web: something that looks like a Google key is in ${keyish.join(', ')}`);
const kb = all.reduce((n, f) => n + fs.statSync(path.join(out, f)).size, 0) / 1024;
console.log(`site: ${all.length} files, ${Math.round(kb)} KB in ${path.relative(root, out) || out}`);
