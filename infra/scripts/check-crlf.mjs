#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function scanDirectory(dir, errors = []) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist" || entry === ".turbo") {
      continue;
    }
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      scanDirectory(fullPath, errors);
    } else if (entry.endsWith(".sh") || entry === "Dockerfile" || entry.startsWith("Dockerfile.")) {
      const content = readFileSync(fullPath);
      if (content.includes("\r\n") || content.includes("\r")) {
        errors.push(fullPath);
      }
    }
  }
  return errors;
}

const foundErrors = scanDirectory(".");
if (foundErrors.length > 0) {
  console.error("❌ CRLF line endings detected in the following container/shell scripts:");
  for (const file of foundErrors) {
    console.error(`   - ${file}`);
  }
  console.error("\nPlease convert them to LF line endings using .gitattributes or dos2unix.");
  process.exit(1);
} else {
  console.log("✅ All shell scripts and Dockerfiles have valid LF line endings.");
  process.exit(0);
}
