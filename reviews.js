/* Past reviews, kept in IndexedDB on this device: what each review drew as it ran (its log, with the frames it looked
 * at), its finding, and a handle to the recording when the browser gives one, so a past review reopens with its video,
 * frames, and report. localStorage keeps the short history the coach reads; this keeps the rest. */
(function (root) {
  const NAME = 'thirdeye', VERSION = 1;
  let opened = null;

  function db() {
    opened ||= new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => { req.result.createObjectStore('reviews', { keyPath: 'id' }); req.result.createObjectStore('thumbs'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return opened;
  }

  async function tx(store, mode, fn) {
    const t = (await db()).transaction(store, mode), req = fn(t.objectStore(store));
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve(req?.result);
      t.onerror = t.onabort = () => reject(t.error);
    });
  }

  /** Saves a review; thumb is a small image URL for the list. */
  async function save(record, thumb) {
    await tx('reviews', 'readwrite', (s) => s.put(record));
    if (thumb) await tx('thumbs', 'readwrite', (s) => s.put(thumb, record.id));
  }

  const get = (id) => tx('reviews', 'readonly', (s) => s.get(id));

  /** { id: thumb URL } for every saved review. */
  async function thumbs() {
    const out = {}, t = (await db()).transaction('thumbs', 'readonly');
    return new Promise((resolve, reject) => {
      t.objectStore('thumbs').openCursor().onsuccess = (e) => { const c = e.target.result; if (!c) return; out[c.key] = c.value; c.continue(); };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
    });
  }

  /** Deletes saved reviews that are no longer in the history. */
  async function keep(ids) {
    const want = new Set(ids);
    for (const store of ['reviews', 'thumbs']) {
      const keys = await tx(store, 'readonly', (s) => s.getAllKeys());
      const gone = keys.filter((k) => !want.has(k));
      if (gone.length) await tx(store, 'readwrite', (s) => { gone.forEach((k) => s.delete(k)); });
    }
  }

  root.ThirdeyeReviews = { save, get, thumbs, keep };
})(window);
