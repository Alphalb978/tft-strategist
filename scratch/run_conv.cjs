const fs = require('fs');
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    let byte = buf[i];
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const toCrc = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(toCrc), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function bmpToPng(bmpPath, pngPath) {
  const bmp = fs.readFileSync(bmpPath);
  const w = bmp.readInt32LE(18);
  const hRaw = bmp.readInt32LE(22);
  const h = Math.abs(hRaw);
  const isTopDown = hRaw < 0;
  const offset = bmp.readUInt32LE(10);
  const bgra = bmp.subarray(offset);

  // Prepare uncompressed scanlines with filter byte 0
  const scanlineLen = 1 + w * 4;
  const rawData = Buffer.alloc(h * scanlineLen);

  for (let y = 0; y < h; y++) {
    const srcY = isTopDown ? y : (h - 1 - y);
    const destOffset = y * scanlineLen;
    rawData[destOffset] = 0; // Filter None
    for (let x = 0; x < w; x++) {
      const srcIdx = (srcY * w + x) * 4;
      const destIdx = destOffset + 1 + x * 4;
      rawData[destIdx] = bgra[srcIdx + 2];     // R
      rawData[destIdx + 1] = bgra[srcIdx + 1]; // G
      rawData[destIdx + 2] = bgra[srcIdx];     // B
      rawData[destIdx + 3] = 255;              // A
    }
  }

  const compressed = zlib.deflateSync(rawData, { level: 6 });

  // PNG Signature
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(w, 0);
  ihdrData.writeUInt32BE(h, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = writeChunk('IHDR', ihdrData);

  // IDAT
  const idatChunk = writeChunk('IDAT', compressed);

  // IEND
  const iendChunk = writeChunk('IEND', Buffer.alloc(0));

  const png = Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
  fs.writeFileSync(pngPath, png);
  console.log(`Converted ${bmpPath} to ${pngPath} (${w}x${h})`);
}

bmpToPng('C:/Users/K/.gemini/antigravity-ide/brain/7a8cb10b-2128-4285-9a79-13849c56b2e2/scratch/live_frame.bmp', 'scratch/full_live_frame.png');
