import { createHash } from "node:crypto";

const sha256 = value => createHash("sha256").update(value).digest("hex");

export function articleSignatures(article, extracted, assets = extracted.assets) {
  const narration = extracted.narration.map(segment => ({
    segmentIndex: segment.segmentIndex, blockIndex: segment.blockIndex, sentenceIndex: segment.sentenceIndex,
    tag: segment.tag, section: segment.section, pauseAfterSeconds: segment.pauseAfterSeconds, splitReason: segment.splitReason,
    textSha256: sha256(segment.text),
    runs: segment.runs.reduce((runs, run) => {
      const previous = runs.at(-1);
      if (previous && previous.lang === run.lang) previous.text += run.text;
      else runs.push({ lang: run.lang, text: run.text });
      return runs;
    }, []).map(run => ({ lang: run.lang, textSha256: sha256(run.text) }))
  }));
  const metadata = Object.fromEntries(Object.entries(article).filter(([key]) => key !== "bodyHtml"));
  return { metadata,
    signatures: { metadata: sha256(JSON.stringify(metadata)), html: sha256(article.bodyHtml),
      structure: sha256(JSON.stringify(extracted.structure)), narration: sha256(JSON.stringify(narration)),
      assets: sha256(JSON.stringify(assets)) },
    html: { bytes: Buffer.byteLength(article.bodyHtml, "utf8"), sha256: sha256(article.bodyHtml) },
    structure: extracted.structure, narration, assets };
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
      const signatures = Object.keys(oldArticle.signatures).filter(key => oldArticle.signatures[key] !== newArticle.signatures[key]);
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
      if (!article.signatures?.html || !article.signatures?.narration) failures.push(`${article.slug}: HTML and narration signatures are required`);
    }
  }
  return failures;
}
