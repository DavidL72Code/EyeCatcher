// afterAllArtifactBuild guard: each .dmg must pass hdiutil's checksum, open, and hold an app whose signature still
// covers every file. v0.1.0's published arm64 DMG did none of these: macOS refused to open it, and parts of Electron's
// framework inside couldn't be read (two copies had been written onto one path, .github/workflows/release.yml). This
// fails a build whose own DMG is like that.
//   node build/check-dmg.cjs <file.dmg>...   (the same check, by hand)
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const why = (e) => String(e.stderr || e.stdout || e.message).trim().split('\n').slice(-3).join('\n');

function detach(mount) {
  for (const force of [false, false, true]) {
    try { return run('hdiutil', ['detach', mount, ...(force ? ['-force'] : [])]); } catch { execFileSync('sleep', ['2']); }
  }
  throw new Error(`check-dmg: couldn't detach ${mount}`);
}

function checkDmg(file) {
  const name = path.basename(file);
  try { run('hdiutil', ['verify', file]); } catch (e) { throw new Error(`check-dmg: ${name} fails hdiutil verify:\n${why(e)}`); }
  const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'check-dmg-'));
  try { run('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, file]); } catch (e) { fs.rmdirSync(mount); throw new Error(`check-dmg: ${name} won't open:\n${why(e)}`); }
  try {
    const app = fs.readdirSync(mount).find((f) => f.endsWith('.app'));
    if (!app) throw new Error(`check-dmg: no .app in ${name}`);
    try { run('codesign', ['--verify', '--deep', '--strict', path.join(mount, app)]); } catch (e) { throw new Error(`check-dmg: the app in ${name} fails its signature check:\n${why(e)}`); }
  } finally { detach(mount); fs.rmdirSync(mount); }
  console.log(`  • check-dmg: ${name} verifies, opens, and its app's signature holds`);
}

exports.default = async function checkDmgs(result) {
  if (process.platform !== 'darwin') return [];
  for (const f of result.artifactPaths.filter((p) => p.endsWith('.dmg'))) checkDmg(f);
  return [];
};

if (require.main === module) {
  let failed = 0;
  for (const f of process.argv.slice(2)) try { checkDmg(f); } catch (e) { console.error(e.message); failed++; }
  process.exit(failed ? 1 : 0);
}
