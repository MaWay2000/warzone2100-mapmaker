// tileset.js — robust tile set utilities for WZ Map Maker

// Exports: TILESETS, getTileCount, getTileFolder,
//          buildTileUrl, loadAllTiles, clearTileCache
//
// If a tileset folder only has 78 images, we can’t conjure the rest.
// By default this loader grabs exactly the declared range of tiles
// and looks only in the configured folders.

export const TILESETS = [
  // Direct mapping of tileset folders to display names
  { name: 'arizona',         folder: 'classic/texpages/tertilesc1hw-128', count: 78 },
  { name: 'urban',           folder: 'classic/texpages/tertilesc2hw-128', count: 81 },
  { name: 'rocky mountains', folder: 'classic/texpages/tertilesc3hw-128', count: 80 },
];

export function getTileFolder(tilesetIndex){
  const i = Math.max(0, Math.min(TILESETS.length - 1, tilesetIndex|0));
  return TILESETS[i].folder;
}

export function getTileCount(tilesetIndex){
  const i = Math.max(0, Math.min(TILESETS.length - 1, tilesetIndex|0));
  return TILESETS[i].count|0;
}

export function buildTileUrl(tilesetIndex, idx){
  const folder = getTileFolder(tilesetIndex);
  const max = getTileCount(tilesetIndex) - 1;
  const clamped = Math.max(0, Math.min(max, idx|0));
  const p2 = String(clamped).padStart(2, '0');
  return `${folder}/tile-${p2}.png`;
}

// Simple per-tileset cache (Promise<Image[]>)
const __tileCache = new Map();
export function clearTileCache(tilesetIndex){
  if (typeof tilesetIndex === 'number') __tileCache.delete(String(tilesetIndex|0));
  else __tileCache.clear();
}

// Core loader. It will try the declared range (0..count-1) using padded
// filenames only. No probing beyond the declared range is performed, and
// we avoid extra network requests by dropping the old unpadded fallback.
export async function loadAllTiles(tilesetIndex, count = getTileCount(tilesetIndex)){
  const key = String(tilesetIndex|0);
  if (__tileCache.has(key)) return __tileCache.get(key);

  const p = (async () => {
    const folder = getTileFolder(tilesetIndex);

    const loadOne = (idx) => new Promise((resolve) => {
      const p2 = String(idx).padStart(2, '0');
      const url = `${folder}/tile-${p2}.png`;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => {
        // not found anywhere: resolve to a 1x1 marker image
        const marker = new Image(); marker.width = 1; marker.height = 1; resolve(marker);
      };
      img.src = url;
    });

    const imgs = [];
    const pushIfReal = (img, idx) => {
      if (img && !(img.width === 1 && img.height === 1)) {
        imgs[idx] = img;
        return true;
      }
      return false;
    };

    // Load declared range
    const tasks = [];
    for (let i = 0; i < count; i++) {
      tasks.push(loadOne(i).then(img => pushIfReal(img, i)));
    }
    await Promise.all(tasks);

    const out = [];
    for (let i = 0; i < count; i++) if (imgs[i]) out.push(imgs[i]);

    try {
      console.log(`[tileset] ${folder} -> loaded ${out.length} tiles (declared count 1046 ${count})`);
    } catch {}
    return out;
  })();

  __tileCache.set(key, p);
  return p;
}
