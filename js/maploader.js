// maploader.js

import { convertV40GameMapToV10 } from './convert.js';

// --- Constants from WZ sources ---
// Classic v10 maps store terrain height directly as an 8-bit value.
const TILE_XFLIP   = 0x8000;
const TILE_YFLIP   = 0x4000;
const TILE_ROTMASK = 0x3000;
const TILE_ROTSHIFT = 12;
const TILE_TRIFLIP = 0x0800;
const TILE_NUMMASK = 0x01ff;           // 9-bit tile index

// ------------------------
// Binary .map grid parsing (v10=3 bytes/tile, v39+=4 bytes/tile)
// ------------------------
export function parseBinaryMap(fileData) {
  if (fileData.length < 16 || String.fromCharCode(fileData[0], fileData[1], fileData[2]) !== "map") {
    return null;
  }

  const dv = new DataView(fileData.buffer, fileData.byteOffset, fileData.byteLength);
  const mapVersion = dv.getUint32(4, true);      // 10, 39 or 40
  const width      = dv.getUint32(8, true);
  const height     = dv.getUint32(12, true);

  if (width <= 0 || width > 256 || height <= 0 || height > 256) return null;

  const numTiles = width * height;
  const bytesPerTile = (mapVersion >= 39) ? 4 : 3;
  const gridStart = 16;
  const need = gridStart + numTiles * bytesPerTile;
  if (fileData.length < need) return null;

  const mapTiles     = Array.from({ length: height }, () => Array(width).fill(0));
  const mapRotations = Array.from({ length: height }, () => Array(width).fill(0));
  const mapHeights   = Array.from({ length: height }, () => Array(width).fill(0));
  const mapXFlip     = Array.from({ length: height }, () => Array(width).fill(false));
  const mapYFlip     = Array.from({ length: height }, () => Array(width).fill(false));
  const mapTriFlip   = Array.from({ length: height }, () => Array(width).fill(false));

  let ofs = gridStart;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tilenum = dv.getUint16(ofs, true); ofs += 2;

      let h;
      if (mapVersion >= 39) {
        // v39+: 16-bit full-range height
        h = dv.getUint16(ofs, true);
        ofs += 2;
      } else {
        // v10: 8-bit height value
        h = dv.getUint8(ofs); ofs += 1;
      }

      const tileIndex = tilenum & TILE_NUMMASK;                 // 0..511
      const rotation  = (tilenum & TILE_ROTMASK) >> TILE_ROTSHIFT; // 0–3
      const xFlip     = !!(tilenum & TILE_XFLIP);
      const yFlip     = !!(tilenum & TILE_YFLIP);
      const triFlip   = !!(tilenum & TILE_TRIFLIP);

      mapTiles[y][x]     = tileIndex;
      mapRotations[y][x] = rotation;
      mapHeights[y][x]   = h;
      mapXFlip[y][x]     = xFlip;
      mapYFlip[y][x]     = yFlip;
      mapTriFlip[y][x]   = triFlip;
    }
  }

  return { 
    mapW: width, 
    mapH: height, 
    mapTiles, 
    mapRotations, 
    mapHeights, 
    mapXFlip, 
    mapYFlip, 
    mapTriFlip,
    format: "binary", 
    mapVersion 
  };
}

// ------------------------
// JSON map parsing
// ------------------------
export function parseJSONMap(text) {
  try {
    const json = JSON.parse(text);
    if (json.mapW && json.mapH && json.tiles) {
      return {
        mapW: json.mapW,
        mapH: json.mapH,
        mapTiles: json.tiles,
        mapRotations: json.rotations ?? [],
        mapHeights: json.heights ?? [],
        mapXFlip: json.xflip ?? [],
        mapYFlip: json.yflip ?? [],
        mapTriFlip: json.triflip ?? [],
        format: "json"
      };
    }
  } catch (e) {}
  return null;
}

// ------------------------
// .lev map parsing (very old format — placeholder; adjust if needed)
// ------------------------
export function parseLevMap(fileData) {
  if (fileData.length > 32) {
    const width = fileData[0];
    const height = fileData[1];
    if (width > 0 && width <= 256 && height > 0 && height <= 256) {
      const mapTiles = Array.from({ length: height }, () => Array(width).fill(0));
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          mapTiles[y][x] = fileData[2 + y * width + x];
        }
      }
      return { 
        mapW: width, 
        mapH: height, 
        mapTiles, 
        mapRotations: [], 
        mapHeights: [], 
        mapXFlip: [], 
        mapYFlip: [], 
        mapTriFlip: [], 
        format: "lev" 
      };
    }
  }
  return null;
}

// ------------------------
// Unified loader
// ------------------------
export async function loadMapUnified(input) {
  let buffer;
  if (input instanceof File) {
    buffer = await input.arrayBuffer();
  } else if (typeof input === "string") {
    const res = await fetch(input);
    buffer = await res.arrayBuffer();
  } else {
    throw new Error("Unsupported input type");
  }

  const bytes = new Uint8Array(buffer);

  // Try JSON
  const text = new TextDecoder().decode(bytes);
  const jsonMap = parseJSONMap(text);
  if (jsonMap) return jsonMap;

  // Try binary .map (v10, v39 or v40)
  if (bytes.length >= 16 && String.fromCharCode(bytes[0], bytes[1], bytes[2]) === "map") {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = dv.getUint32(4, true);
    let mapBytes = bytes;
    if (version >= 39) {
      const converted = convertV40GameMapToV10(bytes);
      if (converted) mapBytes = converted;
    }
    const binMap = parseBinaryMap(mapBytes);
    if (binMap) return binMap;
  }

  // Try .lev
  const levMap = parseLevMap(bytes);
  if (levMap) return levMap;

  throw new Error("Unknown or unsupported map format");
}

// ------------------------
// Tileset detection (.ttp)
// ------------------------
export async function getTilesetIndexFromTtp(zip, TTP_TILESET_MAP) {
  const ttpFileName = Object.keys(zip.files).find(f => f.toLowerCase().endsWith(".ttp"));
  if (!ttpFileName) return 0;

  const ttpData = await zip.files[ttpFileName].async("uint8array");
  const code = (ttpData[12] << 8) | ttpData[13];
  const idx = TTP_TILESET_MAP[code] ?? 0;
  console.log(`Tileset code from ${ttpFileName}: 0x${code.toString(16).padStart(4, '0')} => idx ${idx}`);
  return idx;
}
