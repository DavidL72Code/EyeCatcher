// How much of what decides a game the research step finds, scored against eval/research-checklist.json, which was
// written before any answer was scored. For each game: the checklist items the answer covers, its errors (a habit
// checked by an instrument that can't check it, an aim target in a game with no aiming, cosmetics as what wins, web
// research with too few sources), for one character how many of its abilities it names, how many long-standing
// characters, maps, and weapons the wiki lists hold, and whether the meta names a patch, strong picks, and a change.
//   node eval/researchcheck.mjs              research the six games live (one dev server, real Gemini calls);
//                                            GAMES="Valorant,Rocket League" for some of them
//   node eval/researchcheck.mjs saved.json   score answers saved earlier: [{ name, research }]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const checklist = JSON.parse(fs.readFileSync(path.join(here, 'research-checklist.json'), 'utf8'));

/** Every string in an answer, lowercased, for the checklist's patterns. */
const textOf = (x) => (typeof x === 'string' ? x : Array.isArray(x) ? x.map(textOf).join('\n') : x && typeof x === 'object' ? Object.entries(x).filter(([k]) => k !== 'sources').map(([, v]) => textOf(v)).join('\n') : '').toLowerCase();
const has = (text, patterns) => patterns.some((p) => new RegExp(p, 'i').test(text));
const AIMY = /crosshair|\baim|\bhead|height/i, SHOOTY = /fir(e|ing)|shoot|spray|reload|\bammo|magazine|burst/i, COSMETIC = /skin|cosmetic|decal|banner|title|topper|wheels|chroma/i;

export function score(name, research) {
  const spec = checklist.games[name], text = textOf(research), errors = [];
  const items = Object.entries(spec.items).map(([item, patterns]) => ({ item, covered: has(text, patterns) }));
  for (const m of research?.mistakes || []) {
    const about = `${m.name} ${m.signs}`;
    if (m.checked_by === 'engine' && spec.genre !== 'chess') errors.push(`"${m.name}" checked by the chess engine`);
    if (m.checked_by === 'aim' && !AIMY.test(about)) errors.push(`"${m.name}" checked by aim`);
    if (m.checked_by === 'shots' && !SHOOTY.test(about)) errors.push(`"${m.name}" checked by shots`);
  }
  if (research?.aimTarget && research.aimTarget !== 'none' && spec.genre !== 'shooter') errors.push(`aim target ${research.aimTarget} in a ${spec.genre} game`);
  if (COSMETIC.test(research?.rewards || '')) errors.push('cosmetics in what wins');
  if (research?.researched && (research.sources || []).length < 2) errors.push(`researched with ${(research.sources || []).length} sources`);
  const ch = spec.character, kit = ch ? textOf(research?.character || research) : '';
  const abilities = ch ? ch.abilities.map((a) => ({ name: a, named: kit.includes(a.toLowerCase()) })) : null;
  const lists = textOf(research?.reference || {}), listed = (spec.listed || []).map((n) => ({ name: n, found: lists.includes(n.toLowerCase()) }));
  const m = research?.meta, meta = !!(m?.patch && m.strong?.length >= 3 && m.changes?.length >= 1);
  return { name, covered: items.filter((i) => i.covered).length, of: items.length, missing: items.filter((i) => !i.covered).map((i) => i.item), errors, abilities, listed, meta, facets: research?.facets || null, sources: (research?.sources || []).length, researched: !!research?.researched };
}

function report(rows) {
  for (const r of rows) {
    console.log(`${r.name}: ${r.covered}/${r.of} items, ${r.errors.length} errors, ${r.sources} sources${r.facets ? ` (${Object.entries(r.facets).map(([f, n]) => `${f} ${n}`).join(', ')})` : ''}${r.researched ? '' : ' (not from the web)'}${r.abilities ? `, ${r.abilities.filter((a) => a.named).length}/${r.abilities.length} abilities named` : ''}, ${r.listed.filter((x) => x.found).length}/${r.listed.length} listed, meta ${r.meta ? 'yes' : 'no'}`);
    if (r.listed.some((x) => !x.found)) console.log(`  not listed: ${r.listed.filter((x) => !x.found).map((x) => x.name).join(', ')}`);
    if (r.missing.length) console.log(`  missing: ${r.missing.join('; ')}`);
    if (r.errors.length) console.log(`  errors: ${r.errors.join('; ')}`);
    if (r.abilities?.some((a) => !a.named)) console.log(`  abilities not named: ${r.abilities.filter((a) => !a.named).map((a) => a.name).join(', ')}`);
  }
  const t = rows.reduce((s, r) => ({ covered: s.covered + r.covered, of: s.of + r.of, errors: s.errors + r.errors.length }), { covered: 0, of: 0, errors: 0 });
  const ab = rows.flatMap((r) => r.abilities || []);
  const ls = rows.flatMap((r) => r.listed);
  console.log(`all: ${t.covered}/${t.of} items (${Math.round((100 * t.covered) / t.of)}%), ${t.errors} errors${ab.length ? `, ${ab.filter((a) => a.named).length}/${ab.length} abilities named` : ''}, ${ls.filter((x) => x.found).length}/${ls.length} listed, meta in ${rows.filter((r) => r.meta).length}/${rows.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const saved = process.argv[2];
  if (saved) {
    report(JSON.parse(fs.readFileSync(saved, 'utf8')).filter((g) => checklist.games[g.name]).map((g) => score(g.name, g.research)));
  } else {
    const PORT = 5199;
    const dev = spawn(process.execPath, [path.join(root, 'scripts/dev.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${PORT}/`).then((r) => r.ok, () => false)) break; await new Promise((r) => setTimeout(r, 100)); }
    const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const out = [], file = path.join(here, `results-research-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`);
    try {
      const page = await browser.newPage();
      await page.route('**/__reload*', (r) => r.abort()); // an edit elsewhere mustn't reload the page mid-run
      await page.goto(`http://localhost:${PORT}/`);
      for (const [name, spec] of Object.entries(checklist.games).filter(([n]) => !process.env.GAMES || process.env.GAMES.split(',').includes(n))) {
        const t0 = Date.now();
        const research = await page.evaluate(async ({ name, genre, character }) => {
          localStorage.removeItem('thirdeye.research');
          return window.ThirdeyeLearn.researchGame({ name, genre, character });
        }, { name, genre: spec.genre, character: spec.character?.name || '' });
        out.push({ name, seconds: Math.round((Date.now() - t0) / 1000), research });
        fs.writeFileSync(file, JSON.stringify(out, null, 1));
        console.log(`researched ${name} in ${Math.round((Date.now() - t0) / 1000)} s`);
      }
    } finally { await browser.close(); dev.kill(); }
    console.log(`saved ${path.relative(root, file)}`);
    report(out.map((g) => score(g.name, g.research)));
  }
}
