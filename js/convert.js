// convert.js
// Convert Gamma-style game.map data to binary v40 map format (4 bytes per tile).
// Based on gamma_to_classic.py

// Parse tile types (.ttp or .ttypes) into a mapping table
export function parseTTypes(data) {
  if (!data) return null;

  // Case 1: old plain-text .ttp file
  if (typeof data === "string") {
    const lines = data.split(/\r?\n/);
    const mapping = [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const idx = parseInt(parts[0], 10);
        if (!isNaN(idx)) {
          mapping[idx] = idx; // identity mapping
        }
      }
    }
    return mapping;
  }

  // Case 2: binary .ttypes (Gamma format)
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const entryCount = dv.getUint32(8, true);
  const mapping = [];
  for (let i = 0; i < entryCount; i++) {
    for (let rot = 0; rot < 4; rot++) {
      mapping[(i << 2) | rot] = i; // map all 4 rotated IDs to base index
    }
  }
  return mapping;
}

// Convert Gamma-style game.map to binary v40 (4 bytes per tile)
export function convertGammaGameMapToClassic(gammaData, ttypesMap) {
  if (!gammaData || gammaData.length < 16) return null;

  // Gamma maps start with "map ("
  if (
    gammaData[0] !== 0x6d || // m
    gammaData[1] !== 0x61 || // a
    gammaData[2] !== 0x70 || // p
    gammaData[3] !== 0x20 || // space
    gammaData[4] !== 0x28    // '('
  ) {
    return null; // not Gamma style
  }

  const dv = new DataView(
    gammaData.buffer,
    gammaData.byteOffset,
    gammaData.byteLength
  );

  const width = dv.getInt32(8, true);
  const height = dv.getInt32(12, true);
  if (width <= 0 || height <= 0) return null;

  const tiles = width * height;
  const gridIn = new DataView(
    gammaData.buffer,
    gammaData.byteOffset + 16,
    tiles * 4
  );

  // Output format: "map " header + version + width + height + 4 bytes/tile
  const out = new Uint8Array(16 + tiles * 4);
  out[0] = 0x6d; // 'm'
  out[1] = 0x61; // 'a'
  out[2] = 0x70; // 'p'
  out[3] = 0x20; // ' '

  const dvOut = new DataView(out.buffer);
  dvOut.setUint32(4, 40, true);     // modern v40 binary map version (4 bytes/tile)
  dvOut.setInt32(8, width, true);
  dvOut.setInt32(12, height, true);

  const TILE_ROTSHIFT = 12;          // from maploader.js

  for (let i = 0; i < tiles; i++) {
    const val = gridIn.getUint32(i * 4, true);
    const tile16 = val & 0xffff;          // lower 16 bits = tile + rotation
    const height16 = val >>> 16;          // upper 16 bits = height

    const baseTile = tile16 >>> 2;        // strip rotation bits
    const rotation = tile16 & 0x03;

    const mappedTile = (ttypesMap && ttypesMap[tile16] !== undefined)
      ? ttypesMap[tile16]
      : baseTile;

    const tilenum = (mappedTile & 0x01ff) | (rotation << TILE_ROTSHIFT);
    const offset = 16 + 4 * i;
    dvOut.setUint16(offset, tilenum, true);
    dvOut.setUint16(offset + 2, height16, true); // preserve 16-bit height
  }

  return out;
}

// Convert binary v10 game.map (3 bytes per tile) to v40 format (4 bytes per tile)
export function convertV10GameMapToV40(v10Data) {
  if (!v10Data || v10Data.length < 16) return null;

  // Expect "map " header and version 10
  if (
    v10Data[0] !== 0x6d || // m
    v10Data[1] !== 0x61 || // a
    v10Data[2] !== 0x70 || // p
    v10Data[3] !== 0x20 || // space
    new DataView(v10Data.buffer, v10Data.byteOffset, 16).getUint32(4, true) !== 10
  ) {
    return null;
  }

  const dvIn = new DataView(v10Data.buffer, v10Data.byteOffset, v10Data.byteLength);
  const width = dvIn.getUint32(8, true);
  const height = dvIn.getUint32(12, true);
  if (width <= 0 || height <= 0) return null;

  const tiles = width * height;

  // Output buffer with 4 bytes per tile
  const out = new Uint8Array(16 + tiles * 4);
  out[0] = 0x6d; // 'm'
  out[1] = 0x61; // 'a'
  out[2] = 0x70; // 'p'
  out[3] = 0x20; // ' '

  const dvOut = new DataView(out.buffer);
  dvOut.setUint32(4, 40, true); // v40 map version
  dvOut.setUint32(8, width, true);
  dvOut.setUint32(12, height, true);

  for (let i = 0; i < tiles; i++) {
    const inOffset = 16 + i * 3;
    const tilenum = dvIn.getUint16(inOffset, true);
    const height8 = dvIn.getUint8(inOffset + 2);

    const outOffset = 16 + i * 4;
    dvOut.setUint16(outOffset, tilenum, true);
    dvOut.setUint16(outOffset + 2, height8 << 1, true); // expand to 16-bit height
  }

  return out;
}

// Convert binary v39/v40 game.map (4 bytes per tile) to v10 format (3 bytes per tile)
export function convertV40GameMapToV10(v40Data) {
  if (!v40Data || v40Data.length < 16) return null;

  // Expect "map " header and version >=39
  const dvHeader = new DataView(v40Data.buffer, v40Data.byteOffset, 16);
  const version = dvHeader.getUint32(4, true);
  if (
    v40Data[0] !== 0x6d || // m
    v40Data[1] !== 0x61 || // a
    v40Data[2] !== 0x70 || // p
    v40Data[3] !== 0x20 || // space
    version < 39
  ) {
    return null;
  }

  const dvIn = new DataView(v40Data.buffer, v40Data.byteOffset, v40Data.byteLength);
  const width = dvIn.getUint32(8, true);
  const height = dvIn.getUint32(12, true);
  if (width <= 0 || height <= 0) return null;

  const tiles = width * height;

  const out = new Uint8Array(16 + tiles * 3);
  out[0] = 0x6d; // 'm'
  out[1] = 0x61; // 'a'
  out[2] = 0x70; // 'p'
  out[3] = 0x20; // ' '

  const dvOut = new DataView(out.buffer);
  dvOut.setUint32(4, 10, true); // v10 map version
  dvOut.setUint32(8, width, true);
  dvOut.setUint32(12, height, true);

  for (let i = 0; i < tiles; i++) {
    const inOffset = 16 + i * 4;
    const tilenum = dvIn.getUint16(inOffset, true);
    const height16 = dvIn.getUint16(inOffset + 2, true);
    let height8 = height16 >>> 1; // reduce to 8-bit
    if (height8 > 255) height8 = 255;

    const outOffset = 16 + i * 3;
    dvOut.setUint16(outOffset, tilenum, true);
    dvOut.setUint8(outOffset + 2, height8);
  }

  return out;
}
