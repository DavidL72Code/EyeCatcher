/* Thirdeye video: reads the match recording in the browser. Mediabunny (on WebCodecs) decodes frames at exact times
 * for close looks, and makes the small silent copy that Gemini scans. Only that copy and the frames the agent looks
 * at ever leave the device; the recording's audio, with any voice chat, never does.
 * Times here are seconds from the start of the recording. */
(function (root) {
  const MEDIABUNNY = './vendor/mediabunny.min.mjs'; // mediabunny@1.61.0, shipped with the app (npm run vendor)
  const FILES = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
  const API = 'https://generativelanguage.googleapis.com/v1beta/';
  let mb;
  const lib = () => (mb ||= import(MEDIABUNNY));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stopped = () => new DOMException('Stopped', 'AbortError');

  /** Opens a recording: its video track, size, and length. */
  async function open(file) {
    const M = await lib();
    const input = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(file) });
    const track = await input.getPrimaryVideoTrack().catch(() => null);
    if (!track) throw new Error("That file isn't a video Thirdeye can read. Try an MP4, MKV, or WebM recording.");
    if (!(await track.canDecode())) throw new Error("This browser can't decode that video. Try an MP4 (H.264) recording in Chrome.");
    const start = await track.getFirstTimestamp();
    const duration = (await track.computeDuration()) - start;
    return { file, track, start, duration, width: track.displayWidth, height: track.displayHeight, name: file.name, size: file.size };
  }

  async function toJpeg(canvas, quality) {
    const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/jpeg', quality }) : await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
    const data = btoa(bin);
    return { mimeType: 'image/jpeg', data, url: `data:image/jpeg;base64,${data}` };
  }

  /**
   * Frames at the given times, cropped to crop {x, y, w, h} (frame pixels) and scaled to fit maxDim.
   * Returns [{ t, mimeType, data, url, w, h, canvas }] in time order; a time past the end gives the last frame.
   */
  async function grab(v, times, { crop, maxDim = 768, quality = 0.8 } = {}) {
    const M = await lib();
    const c = crop || { x: 0, y: 0, w: v.width, h: v.height };
    const scale = Math.min(1, maxDim / Math.max(c.w, c.h));
    const w = Math.max(2, Math.round(c.w * scale)), h = Math.max(2, Math.round(c.h * scale));
    const sink = new M.CanvasSink(v.track, { crop: { left: c.x, top: c.y, width: c.w, height: c.h }, width: w, height: h, fit: 'fill' });
    const sorted = [...times].sort((a, b) => a - b), out = [];
    let i = 0;
    for await (const wc of sink.canvasesAtTimestamps(sorted.map((t) => v.start + t))) {
      const t = sorted[i++];
      if (wc) out.push({ t, ...(await toJpeg(wc.canvas, quality)), w, h, canvas: wc.canvas });
    }
    return out;
  }

  /**
   * Calls onFrame({ t, canvas, w, h }) for the frame at each time, in time order, without keeping them: for passes
   * over many frames, like reading the kill feed. crop and maxDim work as in grab.
   */
  async function each(v, times, { crop, maxDim = 768, signal } = {}, onFrame) {
    const M = await lib();
    const c = crop || { x: 0, y: 0, w: v.width, h: v.height };
    const scale = Math.min(1, maxDim / Math.max(c.w, c.h));
    const w = Math.max(2, Math.round(c.w * scale)), h = Math.max(2, Math.round(c.h * scale));
    const sink = new M.CanvasSink(v.track, { crop: { left: c.x, top: c.y, width: c.w, height: c.h }, width: w, height: h, fit: 'fill', poolSize: 2 });
    const sorted = [...times].sort((a, b) => a - b);
    let i = 0;
    for await (const wc of sink.canvasesAtTimestamps(sorted.map((t) => v.start + t))) {
      if (signal?.aborted) throw stopped();
      const t = sorted[i++];
      if (wc) await onFrame({ t, canvas: wc.canvas, w, h });
    }
  }

  /**
   * The small silent copy Gemini scans: 640 px wide at 2 frames a second, VP8 in WebM, timed like the recording so
   * a time Gemini reports is a time in the match. onProgress(fraction) as it goes.
   */
  async function makeProxy(v, { fps = 2, width = 640, onProgress, signal } = {}) {
    const M = await lib();
    const w = Math.min(width, v.width) & ~1, h = Math.round((v.height / v.width) * w / 2) * 2;
    if (!(await M.canEncodeVideo('vp8', { width: w, height: h }))) throw new Error("This browser can't make the scan copy (no VP8 encoder). Use Chrome.");
    const canvas = new OffscreenCanvas(w, h), g = canvas.getContext('2d');
    const output = new M.Output({ format: new M.WebMOutputFormat(), target: new M.BufferTarget() });
    const source = new M.CanvasSource(canvas, { codec: 'vp8', quality: M.QUALITY_LOW, keyFrameInterval: 10 });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    const sink = new M.CanvasSink(v.track, { width: w, height: h, fit: 'fill', decoderOptions: { hardwareAcceleration: 'prefer-hardware' } });
    const times = [];
    for (let t = 0; t < v.duration; t += 1 / fps) times.push(t);
    let i = 0;
    for await (const wc of sink.canvasesAtTimestamps(times.map((t) => v.start + t))) {
      if (signal?.aborted) { await output.cancel(); throw stopped(); }
      if (wc) { g.drawImage(wc.canvas, 0, 0); await source.add(times[i], 1 / fps); }
      if (++i % 10 === 0) onProgress?.(i / times.length);
    }
    await output.finalize();
    onProgress?.(1);
    return new Blob([output.target.buffer], { type: 'video/webm' });
  }

  function send(url, { method = 'POST', headers = {}, body, onProgress, signal }) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open(method, url);
      for (const [k, val] of Object.entries(headers)) x.setRequestHeader(k, val);
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      x.onload = () => resolve(x);
      x.onerror = () => reject(new Error("Couldn't reach Gemini to upload the scan copy."));
      signal?.addEventListener('abort', () => { x.abort(); reject(stopped()); }, { once: true });
      x.send(body);
    });
  }

  /**
   * Uploads the scan copy to the Gemini Files API (kept 48 hours) and waits until Gemini can read it.
   * Returns { uri, mimeType, name }.
   */
  async function upload(blob, { name = 'thirdeye-scan', onProgress, signal } = {}) {
    // through Thirdeye's backend when there is one: it adds the key, so none is sent from here
    const via = root.Gemini.backendUrl(), key = via ? '' : root.Gemini.getKey();
    if (!via && !key) throw new Error('Add a Gemini API key first.');
    const auth = key ? { 'x-goog-api-key': key } : {};
    const start = await send(via ? `${via}/gemini/upload/v1beta/files` : FILES, {
      headers: { ...auth, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(blob.size), 'X-Goog-Upload-Header-Content-Type': blob.type, 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: { display_name: name } }), signal,
    });
    const target = start.getResponseHeader('x-goog-upload-url');
    if (start.status >= 400 || !target) throw new Error(`Gemini refused the upload (${start.status}). ${start.responseText.slice(0, 200)}`);
    const done = await send(target, { headers: { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, body: blob, onProgress, signal });
    if (done.status >= 400) throw new Error(`The upload failed (${done.status}).`);
    let file = JSON.parse(done.responseText).file;
    for (let tries = 0; file.state === 'PROCESSING' && tries < 90; tries++) {
      await sleep(2000);
      if (signal?.aborted) throw stopped();
      file = await (await fetch((via ? `${via}/gemini/v1beta/` : API) + file.name, { headers: auth, signal })).json();
    }
    if (file.state !== 'ACTIVE') throw new Error(`Gemini couldn't process the scan copy (${file.state || 'no state'}).`);
    return { uri: file.uri, mimeType: file.mimeType, name: file.name };
  }

  root.ThirdeyeVideo = { open, grab, each, makeProxy, upload, toJpeg };
})(window);
