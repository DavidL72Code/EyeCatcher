// What the page can ask of the desktop app (desktop/main.mjs). A recording is only ever named by a File the player
// dropped or picked; the app streams back only recordings named that way.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('thirdeyeDesktop', {
  /** Remembers where a recording the player gave the page lives: { path, name, size, lastModified }, or null. */
  remember(file) {
    let p = '';
    try { p = webUtils.getPathForFile(file); } catch {}
    return p ? ipcRenderer.invoke('recording:remember', p) : Promise.resolve(null);
  },
  /** Saves a remembered recording in the Thirdeye folder if the player agrees (asked once): its new place, or null. */
  keep: (p) => ipcRenderer.invoke('recording:keep', String(p)),
  /** A remembered recording, streamed from where it is now: { url, path, name, size, lastModified }, or { missing }. */
  open: (p) => ipcRenderer.invoke('recording:open', String(p)),
  /** Shows a remembered recording in Finder or Explorer. */
  reveal: (p) => ipcRenderer.invoke('recording:reveal', String(p)),
  /** Where the Thirdeye folder is ('~/Movies/Thirdeye'), when the player chose to keep recordings there; else null. */
  library: () => ipcRenderer.invoke('library:where'),
  /** Opens the Thirdeye folder. */
  showLibrary: () => ipcRenderer.invoke('library:show'),
});
