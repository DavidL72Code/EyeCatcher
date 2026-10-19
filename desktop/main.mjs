// Thirdeye as a desktop app: npm run desktop. It runs the same page as the browser version, from the same server
// (scripts/dev.mjs), in a window. What a web page can't do and this can: remember where a recording is on disk, so a
// past review streams the original file, with no copy and no prompt. The page can only name recordings the player gave
// it, by dropping or picking them, so it can't point the app at any other file.
//
// Gemini goes through Thirdeye's backend (server/index.mjs), which holds the key: the address is THIRDEYE_BACKEND, or
// else desktop/config.json. THIRDEYE_BACKEND=direct uses the key in .env instead, for working on the app.
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, TYPES } from '../scripts/dev.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// The page's saved reviews belong to its address, so the port stays the same from one launch to the next.
const PORT = +(process.env.THIRDEYE_PORT || 5170);
const KEEP = 500; // recordings remembered, newest first
if (process.env.THIRDEYE_USER_DATA) app.setPath('userData', process.env.THIRDEYE_USER_DATA);
const config = (() => { try { return JSON.parse(fs.readFileSync(path.join(here, 'config.json'), 'utf8')); } catch { return {}; } })();
const BACKEND = process.env.THIRDEYE_BACKEND || config.backend || '';

const isVideo = (p) => typeof p === 'string' && path.isAbsolute(p) && /^video\//.test(TYPES[path.extname(p).toLowerCase()] || '');
const stat = (p) => { try { const s = fs.statSync(p); return s.isFile() ? s : null; } catch { return null; } };
const about = (p, st) => ({ path: p, name: path.basename(p), size: st.size, lastModified: Math.floor(st.mtimeMs) });

// path -> { size, at }: the recordings the player gave the app, kept between launches; the only files it streams
let known = null;
const knownFile = () => path.join(app.getPath('userData'), 'recordings.json');
function recordings() {
  if (!known) { try { known = JSON.parse(fs.readFileSync(knownFile(), 'utf8')); } catch { known = {}; } }
  return known;
}
function remember(p, st) {
  known = Object.fromEntries(Object.entries({ ...recordings(), [p]: { size: st.size, at: Date.now() } }).sort((a, b) => b[1].at - a[1].at).slice(0, KEEP));
  fs.mkdirSync(path.dirname(knownFile()), { recursive: true });
  fs.writeFileSync(knownFile(), JSON.stringify(known));
}

// ---------- the Thirdeye folder ----------
// With the player's say-so, asked once, each recording they add is also saved in Movies/Thirdeye, so every review's
// recording is in one place. It's a copy: their original is never moved or deleted. On the same disk the copy is a
// clone, so it's instant and takes no extra space; from another disk it takes as long as copying the file.
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function settings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } }
function saveSetting(k, v) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify({ ...settings(), [k]: v }));
}
const libraryDir = () => process.env.THIRDEYE_LIBRARY_DIR || path.join(app.getPath('videos'), 'Thirdeye');
const shortPath = (p) => p.replace(app.getPath('home'), '~');

let asking = null; // one question at a time, however many recordings arrive
function libraryOn(win) {
  const choice = process.env.THIRDEYE_LIBRARY || settings().library;
  if (choice === 'on' || choice === 'off') return Promise.resolve(choice === 'on');
  asking ||= dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Save copies there', 'Not now'], defaultId: 0, cancelId: 1,
    message: 'Keep your recordings in a Thirdeye folder?',
    detail: `Thirdeye can save a copy of each match you add in ${shortPath(libraryDir())}, so every review's recording stays together. Your original file stays where it is.`,
    checkboxLabel: "Don't ask again",
  }).then(({ response, checkboxChecked }) => {
    if (response === 0) saveSetting('library', 'on');
    else if (checkboxChecked) saveSetting('library', 'off');
    return response === 0;
  }).finally(() => { asking = null; });
  return asking;
}

async function intoLibrary(p, st) {
  const dir = libraryDir();
  if (path.dirname(p) === dir) return p;
  await fs.promises.mkdir(dir, { recursive: true });
  const ext = path.extname(p), base = path.basename(p, ext);
  for (let i = 1; i < 100; i++) {
    const dest = path.join(dir, `${base}${i > 1 ? ` (${i})` : ''}${ext}`), there = stat(dest);
    if (there?.size === st.size) return dest; // saved there before
    if (there) continue;
    await fs.promises.copyFile(p, `${dest}.part`, fs.constants.COPYFILE_FICLONE);
    await fs.promises.rename(`${dest}.part`, dest);
    await fs.promises.utimes(dest, st.atime, st.mtime); // the same date, so it's known as the same recording
    return dest;
  }
  return p;
}

const tokens = new Map(); // token -> path, for this launch
let origin = '';

// the path of a File the player dropped or picked, from the preload; saved in the Thirdeye folder when they agreed
ipcMain.handle('recording:remember', async (e, p) => {
  const st = isVideo(p) && stat(p);
  if (!st) return null;
  remember(p, st);
  if (!(await libraryOn(BrowserWindow.fromWebContents(e.sender)))) return about(p, st);
  try {
    const kept = await intoLibrary(p, st), kst = stat(kept);
    remember(kept, kst);
    return about(kept, kst);
  } catch (err) {
    console.warn("Couldn't save the recording in the Thirdeye folder:", err.message);
    return about(p, st);
  }
});
ipcMain.handle('library:show', () => { if (settings().library === 'on' || process.env.THIRDEYE_LIBRARY === 'on') shell.openPath(libraryDir()); });
ipcMain.handle('library:where', () => ((process.env.THIRDEYE_LIBRARY || settings().library) === 'on' ? shortPath(libraryDir()) : null));
// a recording it was given before, streamed from where it is now; missing when it moved or was deleted
ipcMain.handle('recording:open', (_, p) => {
  const st = recordings()[p] && stat(p);
  if (!st) return { missing: true };
  const token = crypto.randomUUID();
  tokens.set(token, p);
  return { ...about(p, st), url: `${origin}/recording/${token}` };
});
ipcMain.handle('recording:reveal', (_, p) => { if (recordings()[p] && stat(p)) shell.showItemInFolder(p); });

function openWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 380, minHeight: 560, backgroundColor: '#0c0d0f', title: 'Thirdeye',
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // links in a review (its research sources) open in the player's browser; a file dropped outside the drop zone
  // doesn't replace the app
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(`${origin}/`)) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  win.loadURL(`${origin}/`);
  return win;
}

async function main() {
  app.on('second-instance', () => { const [win] = BrowserWindow.getAllWindows(); if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  await app.whenReady();
  try {
    const server = await startServer({
      port: PORT, reload: !app.isPackaged && !process.env.THIRDEYE_NO_RELOAD, recording: (t) => tokens.get(t) || null,
      env: BACKEND && BACKEND !== 'direct' ? { THIRDEYE_BACKEND: BACKEND } : {},
    });
    origin = `http://127.0.0.1:${server.port}`;
    app.on('will-quit', () => server.close());
  } catch (e) {
    console.error(`Thirdeye couldn't start: port ${PORT} is taken (${e.code || e.message}). Set THIRDEYE_PORT to another port.`);
    return app.exit(1);
  }
  openWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) openWindow(); });
}

if (app.requestSingleInstanceLock()) main();
else app.quit();
