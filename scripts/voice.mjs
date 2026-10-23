// The critique's voice: Kokoro, a small neural text-to-speech model run on this machine (kokoro-js on onnxruntime), so
// the lines it says never leave it. The model (Kokoro-82M, 8-bit, about 90 MB) is fetched from Hugging Face the first
// time and kept in the transformers cache. Lines are made one at a time, since each one fills the CPU for about as long
// as it takes to say, and kept, so a critique played again is said at once.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const VOICES = { am_michael: 'Michael', af_heart: 'Heart' }; // the voices offered, Kokoro's names to the player's
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

/** A line said by one of VOICES, as WAV bytes. Throws on a voice it doesn't offer or text it won't say. */
export function speech({ text, voice = 'am_michael' }) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  if (!VOICES[voice]) throw new Error(`No voice ${voice}.`);
  if (!line || line.length > MAX_TEXT) throw new Error('Say a line of 1 to 600 characters.');
  const key = `${voice}|${line}`;
  if (kept.has(key)) { const v = kept.get(key); kept.delete(key); kept.set(key, v); return v; }
  // after the line before it, whether that one was said or failed
  const made = (queue = queue.catch(() => {}).then(async () => Buffer.from((await (await model()).generate(line, { voice })).toWav())));
  kept.set(key, made);
  made.catch(() => kept.delete(key));
  while (kept.size > KEEP) kept.delete(kept.keys().next().value);
  return made;
}
