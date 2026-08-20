#!/usr/bin/env node
/**
 * Offline .docx -> plain text extractor.
 *
 * A .docx is a ZIP containing `word/document.xml`. We walk the body in document
 * order so that headings, paragraphs and tables keep their original sequence --
 * ordering matters here because the pricing document associates each table with
 * the heading above it, and a reordered dump would silently mis-attribute
 * prices to the wrong model.
 *
 * Intentionally dependency-free: this sandbox has no registry access, and a
 * money-critical extraction step should not acquire new supply-chain surface.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error("usage: extract-docx.mjs <input.docx> <output.txt>");
  process.exit(2);
}

// Use python's zipfile for inflate rather than hand-rolling DEFLATE.
const xml = execFileSync(
  "python3",
  [
    "-c",
    `import sys,zipfile
z=zipfile.ZipFile(sys.argv[1])
sys.stdout.write(z.read('word/document.xml').decode('utf-8','replace'))`,
    inputPath,
  ],
  { maxBuffer: 1024 * 1024 * 512, encoding: "utf8" },
);

const decodeEntities = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

/** Text of one <w:p>, honouring explicit breaks and tabs. */
function paragraphText(pXml) {
  let out = "";
  const tokens = pXml.matchAll(
    /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>/g,
  );
  for (const t of tokens) {
    if (t[1] !== undefined) out += decodeEntities(t[1]);
    else if (t[0].startsWith("<w:tab")) out += "\t";
    else out += "\n";
  }
  return out;
}

function headingPrefix(pXml) {
  const style = pXml.match(/<w:pStyle\s+w:val="([^"]+)"/)?.[1] ?? "";
  const m = /^Heading(\d)$/i.exec(style) || /^Title$/i.exec(style);
  if (!m) return "";
  const level = /^Title$/i.test(style) ? 1 : Number(m[1]);
  return "#".repeat(Math.min(level, 6)) + " ";
}

const body = xml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? xml;

// Split the body into top-level <w:p> and <w:tbl> blocks, tracking nesting so a
// paragraph inside a table cell is not also emitted as a top-level paragraph.
const lines = [];
const blockRe = /<w:(p|tbl)\b[^>]*?(\/)?>/g;
let cursor = 0;
let match;

function consumeBalanced(tag, startIndex) {
  const openRe = new RegExp(`<w:${tag}\\b[^>]*?(\\/)?>`, "g");
  const closeRe = new RegExp(`</w:${tag}>`, "g");
  let depth = 0;
  let i = startIndex;
  while (i < body.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const o = openRe.exec(body);
    const c = closeRe.exec(body);
    if (o && o[1]) {
      // self-closing
      if (depth === 0) return { end: o.index + o[0].length };
      i = o.index + o[0].length;
      continue;
    }
    if (c && (!o || c.index < o.index)) {
      depth -= 1;
      i = c.index + c[0].length;
      if (depth === 0) return { end: i };
      continue;
    }
    if (o) {
      depth += 1;
      i = o.index + o[0].length;
      continue;
    }
    break;
  }
  return { end: body.length };
}

while ((match = blockRe.exec(body))) {
  if (match.index < cursor) continue;
  const tag = match[1];
  const { end } = consumeBalanced(tag, match.index);
  const chunk = body.slice(match.index, end);
  cursor = end;
  blockRe.lastIndex = end;

  if (tag === "p") {
    const text = paragraphText(chunk).trim();
    lines.push(text ? headingPrefix(chunk) + text : "");
  } else {
    // Table: emit one pipe-delimited line per row.
    lines.push("");
    const rows = chunk.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g);
    for (const row of rows) {
      const cells = [...row[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((c) =>
        [...c[1].matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g)]
          .map((p) => paragraphText(p[0]).trim())
          .filter(Boolean)
          .join(" / ")
          .replace(/\s+/g, " "),
      );
      if (cells.some(Boolean)) lines.push("| " + cells.join(" | ") + " |");
    }
    lines.push("");
  }
}

// Collapse runs of blank lines so the output stays readable.
const text = lines
  .join("\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

writeFileSync(outputPath, text + "\n", "utf8");
console.error(
  `extracted ${text.length} chars / ${text.split("\n").length} lines -> ${outputPath}`,
);
