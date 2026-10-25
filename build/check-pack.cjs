// afterPack guard: fail the build if the packed app holds anything that must never ship —
// eval footage, test records, voice samples, scene clips, keys — or grows past a sane size.
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const BANNED = [/^eval\//, /^tests\//, /^voice-samples\//, /^assets\/scenes\//, /^dist\//, /^site\//, /^env\.js$/, /(^|\/)\.env(\.|$)/, /\.(mp4|mov|webm|mkv)$/i];
const MAX_MB = 600;

function listAsar(file) {
  const out = [];
  const walk = (node, pre) => {
    for (const [name, v] of Object.entries(node.files || {})) {
      const p = pre ? `${pre}/${name}` : name;
      if (v.files) walk(v, p);
      else out.push([p, v.size || 0]);
    }
  };
  walk(asar.getRawHeader(file).header, '');
  return out;
}

function listDir(dir, pre = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = pre ? `${pre}/${e.name}` : e.name;
    return e.isDirectory() ? listDir(path.join(dir, e.name), p) : [[p, fs.statSync(path.join(dir, e.name)).size]];
  });
}

exports.default = async function checkPack(context) {
  const name = context.packager.appInfo.productFilename;
  const res = context.electronPlatformName === 'darwin' ? path.join(context.appOutDir, `${name}.app`, 'Contents', 'Resources') : path.join(context.appOutDir, 'resources');
  const archive = path.join(res, 'app.asar');
  if (!fs.existsSync(archive)) throw new Error(`check-pack: no app.asar at ${archive}`);
  const files = [...listAsar(archive), ...listDir(path.join(res, 'app.asar.unpacked'))];
  const bad = files.filter(([p]) => BANNED.some((re) => re.test(p)));
  if (bad.length) throw new Error(`check-pack: ${bad.length} file(s) that must not ship, e.g.\n  ${bad.slice(0, 10).map(([p]) => p).join('\n  ')}`);
  const mb = files.reduce((n, [, s]) => n + s, 0) / 1e6;
  if (mb > MAX_MB) throw new Error(`check-pack: the app is ${mb.toFixed(0)} MB, over ${MAX_MB} MB`);
  console.log(`  • check-pack: ${files.length} files, ${mb.toFixed(0)} MB, nothing private`);
};
