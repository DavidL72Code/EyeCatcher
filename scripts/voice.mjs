// The critique's voice: Kokoro, a small neural text-to-speech model run on this machine (kokoro-js on onnxruntime), so
// the lines it says never leave it. The model (Kokoro-82M, 8-bit, about 90 MB) is fetched from Hugging Face the first
// time and kept in the transformers cache. Lines are made one at a time, since each one fills the CPU for about as long
// as it takes to say, and kept, so a critique played again is said at once.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
// the voices offered, Kokoro's names to the player's. kokoro-js grades each: Michael C+, the best any male voice gets
// (Fenrir and Puck too); Heart A and Bella A-, the two best of all (kokoro-js 1.2.1, its voices table)
export const VOICES = { am_michael: 'Michael', af_heart: 'Heart', af_bella: 'Bella' };
const KEEP = 200; // lines kept
const MAX_TEXT = 600;

let tts = null, queue = Promise.resolve();
const kept = new Map();

/** Whether Kokoro is installed here (without loading it). */
export function available() {
  try { createRequire(path.join(root, 'package.json')).resolve('kokoro-js'); return true; } catch { return false; }
}

async function model() {
  if (!tts) {
    const req = createRequire(path.join(root, 'package.json'));
    const { KokoroTTS } = await import(req.resolve('kokoro-js'));
    tts = KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'cpu' }).catch((e) => { tts = null; throw e; });
  }
  return tts;
}

// A line is said a sentence at a time, each with the style Kokoro picks for that sentence's own length, as the model is
// meant to be fed (kokoro-js's stream() does the same), with a breath between them. Said whole, a line of three
// sentences came out in one flat run (the user, Oct 25: "the talking is still too robotic"). A piece under a few words
// rides with the next, since a one-word sentence alone comes out clipped.
const BREATH = 0.22; // s of silence between sentences
export function sentencesOf(line) {
  const out = [];
  for (const piece of String(line).split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean)) {
    if (out.length && out.at(-1).split(' ').length < 3) out[out.length - 1] += ` ${piece}`;
    else out.push(piece);
  }
  return out;
}
/** Mono float samples, pieces with a breath between, as 16-bit PCM WAV bytes. */
export function wavOf(pieces, rate, breath = BREATH) {
  const gap = Math.round(rate * breath), n = pieces.reduce((a, p) => a + p.length, 0) + gap * Math.max(0, pieces.length - 1);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  let o = 44;
  pieces.forEach((p, i) => {
    if (i) o += gap * 2; // the breath: Buffer.alloc is silence already
    for (let k = 0; k < p.length; k++, o += 2) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(p[k] * 32767))), o);
  });
  return b;
}
async function say(line, voice) {
  const t = await model(), pieces = [];
  let rate = 24000;
  for (const sentence of sentencesOf(line)) {
    const audio = await t.generate(sentence, { voice });
    pieces.push(audio.audio);
    rate = audio.sampling_rate || rate;
  }
  return wavOf(pieces, rate);
}

/** A line said by one of VOICES, as WAV bytes. Throws on a voice it doesn't offer or text it won't say. */
export function speech({ text, voice = 'am_michael' }) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  if (!VOICES[voice]) throw new Error(`No voice ${voice}.`);
  if (!line || line.length > MAX_TEXT) throw new Error('Say a line of 1 to 600 characters.');
  const key = `${voice}|${line}`;
  if (kept.has(key)) { const v = kept.get(key); kept.delete(key); kept.set(key, v); return v; }
  // after the line before it, whether that one was said or failed
  const made = (queue = queue.catch(() => {}).then(() => say(line, voice)));
  kept.set(key, made);
  made.catch(() => kept.delete(key));
  while (kept.size > KEEP) kept.delete(kept.keys().next().value);
  return made;
}
