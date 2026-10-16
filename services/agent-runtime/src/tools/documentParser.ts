import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import * as zlib from "node:zlib";

const execFileAsync = promisify(execFile);

export interface DocumentParseResult {
  text: string;
  kind: "text" | "pdf" | "docx" | "csv" | "zip" | "unsupported";
  pageCount?: number;
  truncated: boolean;
  itemCount?: number;
}

/**
 * Extracts text from a DOCX file using built-in ZIP parsing and XML decompression.
 */
function extractDocxText(buffer: Buffer): string {
  // Check ZIP magic bytes PK\x03\x04
  if (
    buffer.length < 4 ||
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b ||
    buffer[2] !== 0x03 ||
    buffer[3] !== 0x04
  ) {
    throw new Error("Invalid or corrupt DOCX file: missing ZIP container header");
  }

  // Iterate over local file headers to find word/document.xml
  let offset = 0;
  let documentXmlBuf: Buffer | null = null;

  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      break;
    }

    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraFieldLength = buffer.readUInt16LE(offset + 28);

    const fileNameStart = offset + 30;
    const fileName = buffer.toString("utf8", fileNameStart, fileNameStart + fileNameLength);
    const dataStart = fileNameStart + fileNameLength + extraFieldLength;

    if (fileName === "word/document.xml") {
      const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);
      if (compressionMethod === 0) {
        // Stored (no compression)
        documentXmlBuf = compressedData;
      } else if (compressionMethod === 8) {
        // Deflated (raw deflate stream)
        try {
          documentXmlBuf = zlib.inflateRawSync(compressedData);
        } catch {
          documentXmlBuf = zlib.inflateSync(compressedData);
        }
      }
      break;
    }

    offset = dataStart + compressedSize;
  }

  if (!documentXmlBuf) {
    throw new Error("Invalid DOCX file: word/document.xml not found in archive");
  }

  const xmlStr = documentXmlBuf.toString("utf8");

  // Extract paragraphs: <w:p> ... </w:p>
  const paragraphs: string[] = [];
  const pRegex = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
  let pMatch = pRegex.exec(xmlStr);

  while (pMatch !== null) {
    const pContent = pMatch[1];
    // Extract text within <w:t> tags
    const tRegex = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let tMatch = tRegex.exec(pContent);
    let pText = "";
    while (tMatch !== null) {
      pText += tMatch[1];
      tMatch = tRegex.exec(pContent);
    }
    if (pText.trim()) {
      paragraphs.push(pText.trim());
    }
    pMatch = pRegex.exec(xmlStr);
  }

  if (paragraphs.length === 0) {
    // Fallback: strip all tags
    const fallback = xmlStr
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return fallback;
  }

  return paragraphs.join("\n\n");
}

/**
 * Extracts text from a PDF buffer using pure Node.js streams or pdftotext.
 */
async function extractPdfText(
  filePath: string,
  buffer: Buffer,
): Promise<{ text: string; pageCount?: number }> {
  // Validate PDF header
  const header = buffer.subarray(0, 8).toString("utf8");
  if (!header.startsWith("%PDF-")) {
    throw new Error("Invalid or corrupt PDF file: missing %PDF- header");
  }

  // 1. Try pdftotext binary if installed on the host
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", filePath, "-"]);
    if (stdout && stdout.trim().length > 0) {
      return { text: stdout.trim() };
    }
  } catch {
    // Fallback to internal parser
  }

  // 2. Pure Node.js PDF Stream Extractor
  const textChunks: string[] = [];
  let pageCount = 0;

  // Count /Type /Page objects
  const pageMatches = buffer.toString("binary").match(/\/Type\s*\/Page\b/g);
  if (pageMatches) {
    pageCount = pageMatches.length;
  }

  // Search for stream ... endstream blocks
  const bufStr = buffer.toString("binary");
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match = streamRegex.exec(bufStr);

  while (match !== null) {
    const rawStream = match[1];
    const streamBuf = Buffer.from(rawStream, "binary");

    let decompressed: Buffer | null = null;
    try {
      decompressed = zlib.inflateSync(streamBuf);
    } catch {
      try {
        decompressed = zlib.inflateRawSync(streamBuf);
      } catch {
        // Stream may uncompressed or use different filter
        decompressed = streamBuf;
      }
    }

    if (decompressed) {
      const content = decompressed.toString("utf8");
      // Look for text operators: (...) Tj, [...] TJ
      const tjRegex = /\(([\s\S]*?)\)\s*Tj/g;
      let tjMatch = tjRegex.exec(content);
      while (tjMatch !== null) {
        textChunks.push(decodePdfString(tjMatch[1]));
        tjMatch = tjRegex.exec(content);
      }

      const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
      let tjArrMatch = tjArrayRegex.exec(content);
      while (tjArrMatch !== null) {
        const arrContent = tjArrMatch[1];
        const innerStrings = arrContent.match(/\(([\s\S]*?)\)/g);
        if (innerStrings) {
          const joined = innerStrings.map((s) => decodePdfString(s.slice(1, -1))).join("");
          textChunks.push(joined);
        }
        tjArrMatch = tjArrayRegex.exec(content);
      }
    }
    match = streamRegex.exec(bufStr);
  }

  let text = textChunks.join(" ").replace(/\s+/g, " ").trim();
  if (!text) {
    // If no stream text found, extract any literal strings in the document
    const simpleStringRegex = /\(([^()]{3,})\)/g;
    const fallbackChunks: string[] = [];
    let sMatch = simpleStringRegex.exec(bufStr);
    while (sMatch !== null) {
      const str = decodePdfString(sMatch[1]);
      if (/[a-zA-Z0-9\s]{3,}/.test(str)) {
        fallbackChunks.push(str);
      }
      sMatch = simpleStringRegex.exec(bufStr);
    }
    text = fallbackChunks.join(" ").replace(/\s+/g, " ").trim();
  }

  if (!text) {
    throw new Error("PDF contains no readable text or is an image-only scan.");
  }

  return { text, pageCount: pageCount > 0 ? pageCount : undefined };
}

function decodePdfString(str: string): string {
  return str
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(Number.parseInt(oct, 8)))
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "\b")
    .replace(/\\f/g, "\f")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

/**
 * Inspects a ZIP archive and extracts an inventory of its contents.
 */
function inspectZipArchive(buffer: Buffer): { manifest: string[]; count: number } {
  if (
    buffer.length < 4 ||
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b ||
    buffer[2] !== 0x03 ||
    buffer[3] !== 0x04
  ) {
    throw new Error("Invalid ZIP archive: missing header");
  }

  const files: string[] = [];
  let offset = 0;

  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraFieldLength = buffer.readUInt16LE(offset + 28);
    const fileNameStart = offset + 30;
    const fileName = buffer.toString("utf8", fileNameStart, fileNameStart + fileNameLength);
    files.push(fileName);
    offset = fileNameStart + fileNameLength + extraFieldLength + compressedSize;
  }

  return { manifest: files, count: files.length };
}

/**
 * Parses and extracts text content from various document formats.
 */
export async function parseDocument(
  filePath: string,
  filename: string,
  maxBytes = 200_000,
): Promise<DocumentParseResult> {
  const ext = path.extname(filename).toLowerCase();
  const stat = await fs.stat(filePath);

  // 1. Plain text formats
  const textExtensions = [
    ".txt",
    ".csv",
    ".tsv",
    ".md",
    ".json",
    ".html",
    ".xml",
    ".yaml",
    ".yml",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".go",
    ".rs",
    ".sql",
    ".css",
    ".sh",
    ".env",
  ];

  if (textExtensions.includes(ext)) {
    const toRead = Math.min(stat.size, maxBytes);
    const fh = await fs.open(filePath, "r");
    const buf = Buffer.alloc(toRead);
    await fh.read(buf, 0, toRead, 0);
    await fh.close();

    const kind = ext === ".csv" || ext === ".tsv" ? "csv" : "text";
    return {
      text: buf.toString("utf8"),
      kind,
      truncated: stat.size > toRead,
    };
  }

  // 2. PDF Document
  if (ext === ".pdf") {
    const buf = await fs.readFile(filePath);
    const { text, pageCount } = await extractPdfText(filePath, buf);
    const truncated = text.length > maxBytes;
    return {
      text: truncated ? text.slice(0, maxBytes) : text,
      kind: "pdf",
      pageCount,
      truncated,
    };
  }

  // 3. DOCX Word Document
  if (ext === ".docx") {
    const buf = await fs.readFile(filePath);
    const text = extractDocxText(buf);
    const truncated = text.length > maxBytes;
    return {
      text: truncated ? text.slice(0, maxBytes) : text,
      kind: "docx",
      truncated,
    };
  }

  // 4. ZIP Archive
  if (ext === ".zip") {
    const buf = await fs.readFile(filePath);
    const { manifest, count } = inspectZipArchive(buf);
    const manifestText = `ZIP Archive contains ${count} items:\n${manifest
      .map((f) => `- ${f}`)
      .join("\n")}`;
    return {
      text: manifestText,
      kind: "zip",
      itemCount: count,
      truncated: false,
    };
  }

  // 5. Unsupported
  throw new Error(
    `Unsupported file format: '${ext || "unknown"}'. Supported document formats include PDF (.pdf), Word (.docx), Plain Text (.txt), CSV (.csv), JSON (.json), Markdown (.md), ZIP archives (.zip), and source code files.`,
  );
}
