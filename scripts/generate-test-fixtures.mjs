import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const scratchDir = path.resolve("scratch_tests");
if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

// 1. Create a minimal valid PNG with sharp/canvas or raw PNG header
// 64x64 RGBA PNG with blue background and white triangle/shape
// Or convert SVG to PNG with resvg/canvas or create raw uncompressed PNG
function createPngBuffer() {
  const width = 64;
  const height = 64;
  const rawData = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * 4 + 1);
    rawData[rowOffset] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      // Blue background with a white square in the middle
      if (x >= 20 && x <= 44 && y >= 20 && y <= 44) {
        rawData[pxOffset] = 255; // R
        rawData[pxOffset + 1] = 255; // G
        rawData[pxOffset + 2] = 255; // B
        rawData[pxOffset + 3] = 255; // A
      } else {
        rawData[pxOffset] = 30; // R (Deep Blue)
        rawData[pxOffset + 1] = 58; // G
        rawData[pxOffset + 2] = 138; // B
        rawData[pxOffset + 3] = 255; // A
      }
    }
  }

  const deflated = zlib.deflateSync(rawData);

  function crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
  }

  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crcVal = crc32(Buffer.concat([typeBuf, data]));
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crcVal, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk("IHDR", ihdr);
  const idatChunk = makeChunk("IDAT", deflated);
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

fs.writeFileSync(path.join(scratchDir, "acme_logo.png"), createPngBuffer());

// 2. Sample TXT
fs.writeFileSync(
  path.join(scratchDir, "company_secret.txt"),
  "ORBA ENTERPRISE CONFIDENTIAL REPORT:\nKey Metric 2026: Q3 Revenue reached $42.8M with 84% gross margin.\nLead product code is CyberShield-X9.",
);

// 3. Sample CSV
fs.writeFileSync(
  path.join(scratchDir, "products.csv"),
  "id,product,category,revenue\nP101,QuantumProcessor,Hardware,15.4M\nP102,CyberShield-X9,Security,27.4M\nP103,NeuralSensor,IoT,9.8M",
);

// 4. Corrupted PDF
fs.writeFileSync(
  path.join(scratchDir, "corrupt_document.pdf"),
  "CORRUPTED_NON_PDF_GARBAGE_PAYLOAD_NO_HEADER_NO_TRAILER",
);

// 5. Valid PDF with text
const streamContent =
  "BT /F1 14 Tf 50 700 Td (Orba Quarterly Brief: Project Falcon launch date is November 15, 2026.) Tj ET";
const compressed = zlib.deflateSync(Buffer.from(streamContent));
const pdfBuf = Buffer.concat([
  Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`,
  ),
  compressed,
  Buffer.from(
    "\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R /Size 5 >>\nstartxref\n500\n%%EOF\n",
  ),
]);
fs.writeFileSync(path.join(scratchDir, "quarterly_brief.pdf"), pdfBuf);

console.log("All test fixtures generated in scratch_tests successfully!");
