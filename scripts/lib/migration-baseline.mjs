import { createHash } from "node:crypto";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const canonicalNarrationText = value => value.normalize("NFC").replace(/\s+/g, " ").trim().replace(/\s*([,;:!?])\s*/g, "$1");
const semanticTokens = runs => {
  const tokens = [];
  let whitespace = "";
  for (const run of runs) {
    for (const part of run.text.match(/\s+|\S+/gu) ?? []) {
      if (/^\s+$/u.test(part)) whitespace += part;
      else {
        const lexicalText = `${whitespace}${part}`.trim().replace(/[\p{P}\p{S}]/gu, "").normalize("NFC");
        if (lexicalText) tokens.push({ lang: run.lang, textSha256: sha256(lexicalText) });
        whitespace = "";
      }
    }
  }
  return tokens;
};

export function playerSemanticTokens(segments) {
  const tokens = [];
  const wordPieces = [];
  for (const segment of segments) {
    const words = segment.words ?? [];
    for (const [index, word] of words.entries()) {
      let text = segment.text.slice(word.start, word.end);
      const nextStart = words[index + 1]?.start ?? segment.text.length;
      const gap = segment.text.slice(word.end, nextStart);
      const punctuation = gap.match(/^[\p{P}\p{S}]+/u)?.[0];
      if (punctuation) text += punctuation;
      const nodeKey = (word.nodeIds ?? []).join("/");
      const previous = wordPieces.at(-1);
      if (nodeKey && previous?.nodeKey === nodeKey && previous.lang === segment.lang) previous.text += text;
      else wordPieces.push({ text, lang: segment.lang, nodeKey });
    }
  }
  for (const piece of wordPieces) for (const match of piece.text.matchAll(/\S+/gu)) tokens.push({ text: match[0], lang: piece.lang });
  return tokens;
}

export function articleSignatures(article, extracted, assets = extracted.assets) {
  const editorialSentences = extracted.editorialSentences.map(sentence => ({
    blockIndex: sentence.blockIndex, sentenceIndex: sentence.sentenceIndex,
    tag: sentence.tag, section: sentence.section, pauseKind: sentence.pauseKind,
    pauseAfterSeconds: sentence.pauseAfterSeconds, textSha256: sha256(sentence.text.normalize("NFC").trim()),
    canonicalTextSha256: sha256(canonicalNarrationText(sentence.text)),
    punctuationSha256: sha256((sentence.text.match(/[\p{P}\p{S}]+/gu) ?? []).join("")),
    runs: sentence.runs.map(run => ({ lang: run.lang, textSha256: sha256(run.text.normalize("NFC")) })),
    semanticTokens: semanticTokens(sentence.runs)
  }));
  const legacyChunks = extracted.legacyChunks.map(chunk => ({
    chunkIndex: chunk.chunkIndex, blockIndex: chunk.blockIndex, tag: chunk.tag, section: chunk.section,
    plannedPauseAfterSeconds: chunk.plannedPauseAfterSeconds, splitReason: chunk.splitReason,
    textSha256: sha256(chunk.text),
    runs: chunk.runs.map(run => ({ lang: run.lang, textSha256: sha256(run.text) }))
  }));
  const metadata = Object.fromEntries(Object.entries(article).filter(([key]) => key !== "bodyHtml"));
  return { metadata,
    signatures: { metadata: sha256(JSON.stringify(metadata)), html: sha256(article.bodyHtml),
      structure: sha256(JSON.stringify(extracted.structure)), editorialSentences: sha256(JSON.stringify(editorialSentences)),
      legacyChunks: sha256(JSON.stringify(legacyChunks)),
      assets: sha256(JSON.stringify(assets)) },
    html: { bytes: Buffer.byteLength(article.bodyHtml, "utf8"), sha256: sha256(article.bodyHtml) },
    structure: extracted.structure, editorialSentences, legacyChunks, assets };
}

export function compareCaptureTools(previous, next) {
  const before = new Map((previous.capture?.captureTools ?? []).concat(previous.capture?.sourceTools ?? []).map(tool => [tool.path, tool.sha256]));
  const after = new Map((next.capture?.captureTools ?? []).concat(next.capture?.sourceTools ?? []).map(tool => [tool.path, tool.sha256]));
  const changes = [];
  for (const file of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    if (!before.has(file)) changes.push({ path: file, kind: "added" });
    else if (!after.has(file)) changes.push({ path: file, kind: "removed" });
    else if (before.get(file) !== after.get(file)) changes.push({ path: file, kind: "changed" });
  }
  return changes;
}
export function compareBaselines(previous, next) {
  const before = new Map(previous.articles.map(article => [article.slug, article]));
  const after = new Map(next.articles.map(article => [article.slug, article]));
  const changes = [];
  for (const slug of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const oldArticle = before.get(slug), newArticle = after.get(slug);
    if (!oldArticle) changes.push({ slug, kind: "added" });
    else if (!newArticle) changes.push({ slug, kind: "removed" });
    else {
      const signatures = [...new Set([...Object.keys(oldArticle.signatures), ...Object.keys(newArticle.signatures)])]
        .filter(key => oldArticle.signatures[key] !== newArticle.signatures[key]);
      if (oldArticle.order !== newArticle.order) signatures.push("order");
      if (oldArticle.addedAt !== newArticle.addedAt) signatures.push("addedAt");
      if (oldArticle.source !== newArticle.source) signatures.push("source");
      if (signatures.length) changes.push({ slug, kind: "changed", signatures: [...new Set(signatures)] });
    }
  }
  return changes;
}

export function validateBaseline(baseline) {
  const failures = [];
  if (!/^[0-9a-f]{40}$/.test(baseline?.sha ?? "")) failures.push("sha must be a full Git commit SHA");
  if (!Array.isArray(baseline?.articles)) failures.push("articles must be an array");
  if (baseline?.sourceCount !== baseline?.articles?.length) failures.push("sourceCount must match articles.length");
  if (!Array.isArray(baseline?.capture?.sourceTools) || !Array.isArray(baseline?.capture?.captureTools)) failures.push("capture must identify source and capture tools");
  else {
    const slugs = baseline.articles.map(article => article.slug);
    if (new Set(slugs).size !== slugs.length) failures.push("article slugs must be unique");
    for (const article of baseline.articles) {
      if (!article.addedAt) failures.push(`${article.slug}: addedAt is required`);
      if (!article.signatures?.html || !article.signatures?.editorialSentences || !article.signatures?.legacyChunks) failures.push(`${article.slug}: HTML, editorial sentence, and legacy chunk signatures are required`);
    }
  }
  return failures;
}
