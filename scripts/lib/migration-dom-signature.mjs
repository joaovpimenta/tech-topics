import { createHash } from "node:crypto";

const sha256 = value => createHash("sha256").update(value).digest("hex");

function replaceExactly(source, original, replacement, label) {
  const count = source.split(original).length - 1;
  if (count !== 1) throw new Error(`Could not instrument speech.js ${label}: expected one match, found ${count}`);
  return source.replace(original, replacement);
}

export function instrumentSpeechBuildBlocks(source) {
  const boundary = "        if (!segment || segment.lang !== piece.lang || segment.text.length + text.length > 240) {";
  const instrumentedBoundary = [
    "        const separatorBefore = Boolean(segment && segment.lang === piece.lang &&",
    "          segment.text.length + text.length > 240 && (pendingWhitespace || /^\\s/u.test(text) || /\\s$/u.test(segment.text)));",
    boundary
  ].join("\n");
  let instrumented = replaceExactly(source, "    let sentenceIndex = 0;\n    for (let pieceIndex", "    let sentenceIndex = 0;\n    let pendingWhitespace = false;\n    for (let pieceIndex", "sentence loop");
  instrumented = replaceExactly(instrumented, "      if (piece.owner !== previousOwner) {", "      if (piece.owner !== previousOwner) {\n        pendingWhitespace = false;", "owner boundary");
  instrumented = replaceExactly(instrumented, "      let text = piece.text.replace(/\\s+/g, \" \");", "      let text = piece.text.replace(/\\s+/g, \" \");\n      if (/^\\s+$/u.test(text)) pendingWhitespace = true;", "whitespace capture");
  instrumented = replaceExactly(instrumented, boundary, instrumentedBoundary, "segment boundary");
  instrumented = replaceExactly(instrumented, "          segment = { text: \"\", lang: piece.lang, words: [] };",
    "          segment = { text: \"\", lang: piece.lang, words: [], separatorBefore };", "segment creation");
  instrumented = replaceExactly(instrumented,
    "      for (const word of piece.nodes) if (!block.words.includes(word)) block.words.push(word);",
    "      pendingWhitespace = false;\n      for (const word of piece.nodes) if (!block.words.includes(word)) block.words.push(word);", "whitespace reset");
  return instrumented;
}

export function canonicalSpeechRuns(runs) {
  if (!Array.isArray(runs)) return null;
  const grouped = [];
  for (const run of runs) {
    if (!run || typeof run.lang !== "string" || typeof run.text !== "string" ||
        (run.separatorBefore !== undefined && typeof run.separatorBefore !== "boolean")) return null;
    const text = `${run.separatorBefore ? " " : ""}${run.text}`;
    const previous = grouped.at(-1);
    if (previous?.lang === run.lang) previous.text += text;
    else grouped.push({ lang: run.lang, text });
  }
  return grouped.map(({ lang, text }) => ({ lang, text: text.normalize("NFC").replace(/\s+/gu, " ").trim() }))
    .filter(run => run.text);
}

export function spokenRunsSignature(runs) {
  const canonical = canonicalSpeechRuns(runs);
  return canonical?.length ? sha256(JSON.stringify(canonical)) : null;
}
