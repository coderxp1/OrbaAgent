import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseDocument } from "./documentParser.js";

function createMockZipBuffer(files: Array<{ name: string; content: string | Buffer }>): Buffer {
  const parts: Buffer[] = [];
  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const dataBuf = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content, "utf8");
    const compressed = zlib.deflateRawSync(dataBuf);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // Local file header signature
    header.writeUInt16LE(20, 4); // Version needed to extract
    header.writeUInt16LE(0, 6); // General purpose bit flag
    header.writeUInt16LE(8, 8); // Compression method (deflated)
    header.writeUInt16LE(0, 10); // File last mod time
    header.writeUInt16LE(0, 12); // File last mod date
    header.writeUInt32LE(0, 14); // CRC32 (dummy)
    header.writeUInt32LE(compressed.length, 18); // Compressed size
    header.writeUInt32LE(dataBuf.length, 22); // Uncompressed size
    header.writeUInt16LE(nameBuf.length, 26); // File name length
    header.writeUInt16LE(0, 28); // Extra field length

    parts.push(header, nameBuf, compressed);
  }
  return Buffer.concat(parts);
}

describe("DocumentParser", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "orba-doc-parser-test-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("extracts plain text and markdown documents", async () => {
    const textPath = path.join(tmpDir, "report.txt");
    await fs.writeFile(textPath, "Q3 Financial Growth: +24% YoY revenue.", "utf8");

    const result = await parseDocument(textPath, "report.txt");
    expect(result.kind).toBe("text");
    expect(result.text).toContain("Q3 Financial Growth: +24% YoY revenue.");
    expect(result.truncated).toBe(false);
  });

  it("extracts CSV documents", async () => {
    const csvPath = path.join(tmpDir, "users.csv");
    await fs.writeFile(csvPath, "id,name,role\n1,Alice,Admin\n2,Bob,Editor", "utf8");

    const result = await parseDocument(csvPath, "users.csv");
    expect(result.kind).toBe("csv");
    expect(result.text).toContain("1,Alice,Admin");
    expect(result.text).toContain("2,Bob,Editor");
  });

  it("extracts DOCX word document paragraphs", async () => {
    const docxXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>OrbaAgent Commercial Strategy</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Viral campaign target: 15 seconds multi-clip video.</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

    const docxBuffer = createMockZipBuffer([{ name: "word/document.xml", content: docxXml }]);
    const docxPath = path.join(tmpDir, "strategy.docx");
    await fs.writeFile(docxPath, docxBuffer);

    const result = await parseDocument(docxPath, "strategy.docx");
    expect(result.kind).toBe("docx");
    expect(result.text).toContain("OrbaAgent Commercial Strategy");
    expect(result.text).toContain("Viral campaign target: 15 seconds multi-clip video.");
  });

  it("extracts readable text from PDF streams", async () => {
    // Generate a valid minimal PDF with FlateDecode text stream
    const textStream = "BT /F1 12 Tf 72 712 Td (OrbaAgent Multimodal Intelligence) Tj ET";
    const compressedStream = zlib.deflateSync(Buffer.from(textStream, "utf8"));

    const pdfContent = Buffer.concat([
      Buffer.from(
        `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length ${compressedStream.length} /Filter /FlateDecode >>\nstream\n`,
      ),
      compressedStream,
      Buffer.from(
        "\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R /Size 5 >>\nstartxref\n500\n%%EOF\n",
      ),
    ]);

    const pdfPath = path.join(tmpDir, "contract.pdf");
    await fs.writeFile(pdfPath, pdfContent);

    const result = await parseDocument(pdfPath, "contract.pdf");
    expect(result.kind).toBe("pdf");
    expect(result.text).toContain("OrbaAgent Multimodal Intelligence");
  });

  it("throws clear error for corrupt or invalid PDF", async () => {
    const corruptPdfPath = path.join(tmpDir, "corrupt.pdf");
    await fs.writeFile(corruptPdfPath, "This is not a real PDF file contents", "utf8");

    await expect(parseDocument(corruptPdfPath, "corrupt.pdf")).rejects.toThrow(
      "Invalid or corrupt PDF file",
    );
  });

  it("inspects ZIP archive manifest", async () => {
    const zipBuffer = createMockZipBuffer([
      { name: "assets/logo.png", content: "dummy-png" },
      { name: "data/config.json", content: "{}" },
    ]);
    const zipPath = path.join(tmpDir, "archive.zip");
    await fs.writeFile(zipPath, zipBuffer);

    const result = await parseDocument(zipPath, "archive.zip");
    expect(result.kind).toBe("zip");
    expect(result.itemCount).toBe(2);
    expect(result.text).toContain("assets/logo.png");
    expect(result.text).toContain("data/config.json");
  });

  it("throws clear error for unsupported file formats", async () => {
    const binPath = path.join(tmpDir, "program.exe");
    await fs.writeFile(binPath, Buffer.from([0x4d, 0x5a, 0x90, 0x00]));

    await expect(parseDocument(binPath, "program.exe")).rejects.toThrow(
      "Unsupported file format: '.exe'",
    );
  });
});
