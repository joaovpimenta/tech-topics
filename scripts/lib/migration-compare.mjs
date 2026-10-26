import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { spokenRunsSignature } from "./migration-dom-signature.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const ZERO_SHA = "0".repeat(40);
const NARRATABLE_METADATA = new Set(["title", "dek", "speechMarkup", "language"]);
const FRAMING_METADATA = new Set();

export function runGitText(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
}

export function assertCommitSha(sha, label) {
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha) || sha === ZERO_SHA) {
    throw new Error(`${label} must be an explicitly supplied, non-zero full Git SHA`);
  }
}

export function validateIndependentBaseline(baseline) {
  const errors = [];
  assertCommitSha(baseline?.sha, "baseline.sha");
  if (baseline.schemaVersion !== 3) errors.push("baseline schemaVersion must be 3");
  if (!Array.isArray(baseline.articles) || baseline.articles.length === 0) errors.push("baseline articles must be a non-empty array");
  if (baseline.sourceCount !== baseline.articles?.length) errors.push("baseline sourceCount must match articles.length");
  if (!Array.isArray(baseline.capture?.sourceTools) || !Array.isArray(baseline.capture?.captureTools)) errors.push("baseline must identify capture and source tools");
  else if (!baseline.capture.sourceTools.length || !baseline.capture.captureTools.length) errors.push("baseline capture/source tool fingerprints must be non-empty");
  const slugs = (baseline.articles ?? []).map(article => article.slug);
  if (new Set(slugs).size !== slugs.length) errors.push("baseline has duplicate article slugs");
  for (const article of baseline.articles ?? []) {
    if (typeof article.slug !== "string" || !article.slug) errors.push("baseline article slug is required");
    if (!article.addedAt || !Array.isArray(article.editorialSentences) || !Array.isArray(article.legacyChunks)) errors.push(`${article.slug ?? "article"}: baseline history and Python signatures are required`);
    if (typeof article.source !== "string" || typeof article.sourceBlob !== "string" || !/^[0-9a-f]{40}$/.test(article.sourceBlob)) errors.push(`${article.slug ?? "article"}: baseline source path and Git blob SHA are required`);
  }
  if (errors.length) throw new Error(errors.join("; "));
  return baseline;
}

export function discoverArticleSources(entries, ref) {
  const sources = new Map();
  for (const file of entries) {
    if (!file.startsWith("content/articles/")) continue;
    const match = file.match(/^content\/articles\/([a-z0-9]+(?:-[a-z0-9]+)*)\.(json|md)$/);
    if (!match || ["index", "catalog"].includes(match[1])) continue;
    const [, slug, extension] = match;
    if (!sources.has(slug)) sources.set(slug, []);
    sources.get(slug).push({ file, extension });
  }
  for (const [slug, records] of sources) if (records.length !== 1) {
    throw new Error(`${ref}: duplicate sources for ${slug}: ${records.map(record => record.file).join(", ")}`);
  }
  const inventory = [...sources].map(([slug, [record]]) => ({ slug, ...record })).sort((a, b) => a.slug.localeCompare(b.slug));
  if (!inventory.length) throw new Error(`${ref}: no article sources found`);
  return inventory;
}

export function firstAdditionDate(historyOutput, slug) {
  const value = historyOutput.split(/\r?\n/).find(Boolean);
  if (!value) throw new Error(`Git history has no first addition for ${slug}`);
  return value;
}

export function articleForNarrationExtraction(article) {
  return { ...article.metadata, bodyHtml: article.bodyHtml };
}

export function isArticleNavigationLink(asset) {
  if (asset?.tag !== "a" || asset.attribute !== "href" || typeof asset.value !== "string") return false;
  const path = asset.value.split(/[?#]/, 1)[0].replaceAll("\\", "/").split("/").at(-1).toLowerCase();
  return path === "article.html" || path === "index.html";
}

export function compareNarration(before, after) {
  const first = firstDifference(before, after);
  return first ? { changed: true, firstDivergence: first } : { changed: false, firstDivergence: null };
}

function firstDifference(before, after, path = "") {
  if (Object.is(before, after)) return null;
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after)) return { path, before, after };
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index++) {
      if (index >= before.length || index >= after.length) return { path: `${path}[${index}]`, before: before[index] ?? null, after: after[index] ?? null };
      const difference = firstDifference(before[index], after[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (before && after && typeof before === "object" && typeof after === "object") {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      if (!Object.hasOwn(before, key) || !Object.hasOwn(after, key)) return { path: path ? `${path}.${key}` : key, before: before[key] ?? null, after: after[key] ?? null };
      const difference = firstDifference(before[key], after[key], path ? `${path}.${key}` : key);
      if (difference) return difference;
    }
    return null;
  }
  return { path, before, after };
}

function projection(article) {
  return {
    slug: article.slug,
    metadata: Object.fromEntries([...NARRATABLE_METADATA, ...FRAMING_METADATA].filter(key => Object.hasOwn(article.metadata, key)).map(key => [key, article.metadata[key]])),
    sentences: article.editorialSentences,
    structure: article.structure,
    legacyChunks: article.legacyChunks,
    assets: article.assets
  };
}

function speechAttributes(structure = {}) {
  return (structure.elements ?? []).flatMap((element, index) => {
    const attributes = { index, tag: element.tag, lang: element.lang ?? null, ttsSay: element.ttsSay ?? null, ttsMode: element.ttsMode ?? null };
    return attributes.lang || attributes.ttsSay || attributes.ttsMode ? [attributes] : [];
  });
}

function structuralShape(structure = {}) {
  return {
    ids: structure.ids ?? [],
    elements: (structure.elements ?? []).map(({ lang, ttsSay, ttsMode, ...element }) => element),
    urls: structure.urls ?? []
  };
}

function domFrames(record) {
  return record.domUnitSignatures.map(unit => ({ blockIndex: unit.blockIndex, sentenceIndex: unit.sentenceIndex }));
}

function frameKey(frame) {
  return `${frame.blockIndex}:${frame.sentenceIndex}`;
}

function sourceToDomSentenceMap(sentences, record, slug, side, blockers) {
  const units = record.domUnitSignatures;
  if (sentences.length !== units.length) {
    blockers.push({ slug, kind: "dom-chapters", side,
      reason: "Python sentences cannot be mapped to native DOM units: ordered sentence counts differ",
      firstDivergence: { path: "sentenceCount", before: sentences.length, after: units.length } });
    return null;
  }
  const sourceKeys = new Set();
  const domKeys = new Set();
  const mapping = new Map();
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index], unit = units[index];
    const sourceKey = frameKey(sentence), domKey = frameKey(unit);
    const sourceSignature = spokenRunsSignature(sentence.runs);
    if (!sourceSignature || sourceSignature !== unit.spokenRunsSha256) {
      blockers.push({ slug, kind: "dom-chapters", side,
        reason: "Python sentence cannot be mapped to its native DOM unit by spoken language/text runs",
        firstDivergence: { path: `spokenRuns[${index}]`, before: sourceSignature, after: unit.spokenRunsSha256 } });
      return null;
    }
    if (sourceKeys.has(sourceKey) || domKeys.has(domKey)) {
      blockers.push({ slug, kind: "dom-chapters", side,
        reason: "Python sentence and native DOM unit mapping contains duplicate frame indices",
        firstDivergence: { path: `frames[${index}]`, before: sourceKey, after: domKey } });
      return null;
    }
    sourceKeys.add(sourceKey);
    domKeys.add(domKey);
    mapping.set(sourceKey, domKey);
  }
  return mapping;
}

function narrationChangedDomFrames(oldProjection, newProjection, oldSentences, newSentences, oldSourceToDom, newSourceToDom) {
  const allowed = new Set();
  const allowTaggedSentences = (tag, sentences, sourceToDom) => {
    for (const sentence of sentences) {
      if (sentence.tag !== tag) continue;
      const mapped = sourceToDom.get(frameKey(sentence));
      if (mapped) allowed.add(mapped);
    }
  };
  const sentenceCount = Math.max(oldSentences.length, newSentences.length);
  for (let index = 0; index < sentenceCount; index += 1) {
    const oldSentence = oldSentences[index], newSentence = newSentences[index];
    const oldNarration = oldSentence && { text: oldSentence.text, runs: oldSentence.runs };
    const newNarration = newSentence && { text: newSentence.text, runs: newSentence.runs };
    if (compareNarration(oldNarration, newNarration).changed) {
      if (oldSentence) {
        const mapped = oldSourceToDom.get(frameKey(oldSentence));
        if (mapped) allowed.add(mapped);
      }
      if (newSentence) {
        const mapped = newSourceToDom.get(frameKey(newSentence));
        if (mapped) allowed.add(mapped);
      }
    }
  }
  for (const field of ["title", "dek"]) {
    if (compareNarration(oldProjection.metadata[field], newProjection.metadata[field]).changed) {
      allowTaggedSentences(field, oldSentences, oldSourceToDom);
      allowTaggedSentences(field, newSentences, newSourceToDom);
    }
    const oldSpeechMarkup = oldProjection.metadata.speechMarkup ?? {};
    const newSpeechMarkup = newProjection.metadata.speechMarkup ?? {};
    if (compareNarration(oldSpeechMarkup[field], newSpeechMarkup[field]).changed) {
      allowTaggedSentences(field, oldSentences, oldSourceToDom);
      allowTaggedSentences(field, newSentences, newSourceToDom);
    }
  }
  return allowed;
}

function validateDomRecord(record, slug, side, blockers) {
  if (!Array.isArray(record.domUnitSignatures) || !Array.isArray(record.mountedDomUnitSignatures) ||
      typeof record.chaptersSignature !== "string" || typeof record.indexesMatch !== "boolean" ||
      typeof record.mountedCloneMatches !== "boolean" || !Number.isInteger(record.domUnits) || !Number.isInteger(record.chapterUnits) ||
      !record.domUnitSignatures.every(unit => unit && typeof unit === "object" &&
        Number.isInteger(unit.blockIndex) && Number.isInteger(unit.sentenceIndex) &&
        /^[0-9a-f]{64}$/.test(unit.sha256 ?? "") && /^[0-9a-f]{64}$/.test(unit.spokenRunsSha256 ?? "")) ||
      !record.mountedDomUnitSignatures.every(unit => unit && typeof unit === "object" &&
        Number.isInteger(unit.blockIndex) && Number.isInteger(unit.sentenceIndex) &&
        /^[0-9a-f]{64}$/.test(unit.sha256 ?? "") && /^[0-9a-f]{64}$/.test(unit.spokenRunsSha256 ?? ""))) {
    blockers.push({ slug, kind: "dom-chapters", side, reason: "DOM/chapter audit record is incomplete" });
    return null;
  }
  const cloneFrames = domFrames(record);
  const mountedFrames = domFrames({ domUnitSignatures: record.mountedDomUnitSignatures });
  const fullMountMismatch = compareNarration(record.domUnitSignatures, record.mountedDomUnitSignatures);
  if (!record.mountedCloneMatches || fullMountMismatch.changed) {
    blockers.push({ slug, kind: "dom-chapters", side, reason: "mounted player differs from reconstructed DOM", firstDivergence: fullMountMismatch.firstDivergence });
  }
  const invalidFrame = [...cloneFrames, ...mountedFrames].some(frame => !Number.isInteger(frame.blockIndex) || frame.blockIndex < 0 || !Number.isInteger(frame.sentenceIndex) || frame.sentenceIndex < 0);
  if (invalidFrame || new Set(cloneFrames.map(frameKey)).size !== cloneFrames.length ||
      new Set(mountedFrames.map(frameKey)).size !== mountedFrames.length ||
      record.domUnits !== cloneFrames.length || record.chapterUnits !== cloneFrames.length || record.indexesMatch !== true) {
    blockers.push({ slug, kind: "dom-chapters", side, reason: "chapter indices do not match the DOM sentence map", firstDivergence: { path: "indexesMatch", before: true, after: record.indexesMatch } });
  }
  return { frames: cloneFrames, chapters: record.chaptersSignature };
}

function indexDomAudit(report, side, blockers) {
  if (!Array.isArray(report?.articles)) {
    blockers.push({ kind: "dom-chapters", side, reason: "DOM/chapter audit has no article records" });
    return new Map();
  }
  const records = new Map();
  for (const record of report.articles) {
    if (typeof record?.slug !== "string" || !record.slug) {
      blockers.push({ kind: "dom-chapters", side, reason: "DOM/chapter audit contains a record without a slug" });
      continue;
    }
    if (records.has(record.slug)) {
      blockers.push({ slug: record.slug, kind: "dom-chapters", side, reason: "DOM/chapter audit contains duplicate article records" });
      continue;
    }
    records.set(record.slug, record);
  }
  return records;
}

export function compareArticleStates(before, after, { authorizedRemovals = [], domBefore, domAfter } = {}) {
  const oldArticles = new Map(before.articles.map(article => [article.slug, article]));
  const newArticles = new Map(after.articles.map(article => [article.slug, article]));
  const allowed = new Set(authorizedRemovals);
  const narration = [], framing = [], blockers = [], selection = [];
  const slugs = [...new Set([...oldArticles.keys(), ...newArticles.keys()])].sort();
  for (const slug of slugs) {
    const oldArticle = oldArticles.get(slug), newArticle = newArticles.get(slug);
    if (!oldArticle) {
      blockers.push({ slug, kind: "added", reason: "new slug requires an explicit migration plan" });
      continue;
    }
    if (!newArticle) {
      if (!allowed.has(slug)) blockers.push({ slug, kind: "removed", reason: "deletion requires explicit authorization" });
      continue;
    }
    if (oldArticle.addedAt !== newArticle.addedAt) {
      blockers.push({ slug, kind: "history", reason: "addedAt changed", before: oldArticle.addedAt, after: newArticle.addedAt });
    }
    if (oldArticle.order !== undefined && newArticle.order !== undefined && oldArticle.order !== newArticle.order) {
      blockers.push({ slug, kind: "history", reason: "publication order changed", before: oldArticle.order, after: newArticle.order });
    }
    const oldProjection = projection(oldArticle), newProjection = projection(newArticle);
    const oldSentences = oldProjection.sentences, newSentences = newProjection.sentences;
    const oldNarrative = { metadata: oldProjection.metadata, speechAttributes: speechAttributes(oldProjection.structure), sentences: oldSentences.map(({ textSha256, punctuationSha256, runs }) => ({ textSha256, punctuationSha256, runs })) };
    const newNarrative = { metadata: newProjection.metadata, speechAttributes: speechAttributes(newProjection.structure), sentences: newSentences.map(({ textSha256, punctuationSha256, runs }) => ({ textSha256, punctuationSha256, runs })) };
    const narrativeDiff = compareNarration(oldNarrative, newNarrative);
    if (narrativeDiff.changed) narration.push({ slug, firstDivergence: narrativeDiff.firstDivergence });
    const oldFraming = { structure: structuralShape(oldProjection.structure), sentenceFrames: oldSentences.map(({ blockIndex, sentenceIndex, tag, section, pauseKind, pauseAfterSeconds }) => ({ blockIndex, sentenceIndex, tag, section, pauseKind, pauseAfterSeconds })), legacyChunks: oldProjection.legacyChunks.map(({ chunkIndex, blockIndex, tag, section, plannedPauseAfterSeconds, splitReason }) => ({ chunkIndex, blockIndex, tag, section, plannedPauseAfterSeconds, splitReason })), assets: oldProjection.assets };
    const newFraming = { structure: structuralShape(newProjection.structure), sentenceFrames: newSentences.map(({ blockIndex, sentenceIndex, tag, section, pauseKind, pauseAfterSeconds }) => ({ blockIndex, sentenceIndex, tag, section, pauseKind, pauseAfterSeconds })), legacyChunks: newProjection.legacyChunks.map(({ chunkIndex, blockIndex, tag, section, plannedPauseAfterSeconds, splitReason }) => ({ chunkIndex, blockIndex, tag, section, plannedPauseAfterSeconds, splitReason })), assets: newProjection.assets };
    const framingDiff = compareNarration(oldFraming, newFraming);
    if (framingDiff.changed) {
      framing.push({ slug, firstDivergence: framingDiff.firstDivergence });
      blockers.push({ slug, kind: "framing", reason: "article structure, block/sentence boundaries, indices, pauses or assets changed", firstDivergence: framingDiff.firstDivergence });
    }
  }
  if (!domBefore || !domAfter) blockers.push({ kind: "dom-chapters", reason: "before and after DOM/chapter audit reports are required" });
  else {
    const oldDom = indexDomAudit(domBefore, "before", blockers);
    const newDom = indexDomAudit(domAfter, "after", blockers);
    for (const slug of slugs) {
      if (!oldArticles.has(slug) || !newArticles.has(slug)) continue;
      const oldRecord = oldDom.get(slug), newRecord = newDom.get(slug);
      if (!oldRecord || !newRecord) { blockers.push({ slug, kind: "dom-chapters", reason: "DOM/chapter audit is missing this slug" }); continue; }
      const oldProjection = projection(oldArticles.get(slug)), newProjection = projection(newArticles.get(slug));
      const oldSentences = oldProjection.sentences, newSentences = newProjection.sentences;
      const oldContract = validateDomRecord(oldRecord, slug, "before", blockers);
      const newContract = validateDomRecord(newRecord, slug, "after", blockers);
      if (!oldContract || !newContract) continue;
      const oldSourceToDom = sourceToDomSentenceMap(oldSentences, oldRecord, slug, "before", blockers);
      const newSourceToDom = sourceToDomSentenceMap(newSentences, newRecord, slug, "after", blockers);
      if (!oldSourceToDom || !newSourceToDom) continue;
      const allowedNarrationFrames = narrationChangedDomFrames(oldProjection, newProjection, oldSentences, newSentences, oldSourceToDom, newSourceToDom);
      const stableOldSignatures = oldRecord.domUnitSignatures.filter(unit => !allowedNarrationFrames.has(frameKey(unit)));
      const stableNewSignatures = newRecord.domUnitSignatures.filter(unit => !allowedNarrationFrames.has(frameKey(unit)));
      const difference = compareNarration({ domFrames: oldContract.frames, chapters: oldContract.chapters, stableDomUnitSignatures: stableOldSignatures },
        { domFrames: newContract.frames, chapters: newContract.chapters, stableDomUnitSignatures: stableNewSignatures });
      if (difference.changed) {
        framing.push({ slug, contract: "dom-chapters", firstDivergence: difference.firstDivergence });
        const reason = difference.firstDivergence.path.startsWith("stableDomUnitSignatures")
          ? "native DOM signature changed without narrated source change"
          : "DOM mapping or chapter index sequence changed";
        blockers.push({ slug, kind: "dom-chapters", reason, firstDivergence: difference.firstDivergence });
      }
    }
  }
  for (const change of narration) if (!blockers.some(blocker => !blocker.slug || blocker.slug === change.slug)) selection.push(change.slug);
  return { narration, framing, selection, blockers };
}

export function compareAgainstInitialBaseline(current, baseline) {
  const original = new Map(baseline.articles.map(article => [article.slug, article]));
  const currentSlugs = new Set(current.articles.map(article => article.slug));
  const changes = current.articles.flatMap(article => {
    const initial = original.get(article.slug);
    if (!initial) return [{ slug: article.slug, kind: "missing-in-initial-baseline" }];
    const initialSentences = initial.editorialSentences.map(({ textSha256, punctuationSha256, runs, blockIndex, sentenceIndex, tag, section, pauseKind, pauseAfterSeconds }) => ({ textSha256, punctuationSha256, runs, blockIndex, sentenceIndex, tag, section, pauseKind, pauseAfterSeconds }));
    const currentSentences = article.editorialSentences.map(sentence => ({
      textSha256: sha256(sentence.text.normalize("NFC").trim()),
      punctuationSha256: sha256((sentence.text.match(/[\p{P}\p{S}]+/gu) ?? []).join("")),
      runs: sentence.runs.map(run => ({ lang: run.lang, textSha256: sha256(run.text.normalize("NFC")) })),
      blockIndex: sentence.blockIndex, sentenceIndex: sentence.sentenceIndex, tag: sentence.tag, section: sentence.section,
      pauseKind: sentence.pauseKind, pauseAfterSeconds: sentence.pauseAfterSeconds
    }));
    const initialChunks = initial.legacyChunks.map(({ chunkIndex, blockIndex, tag, section, plannedPauseAfterSeconds, splitReason, textSha256, runs }) => ({ chunkIndex, blockIndex, tag, section, plannedPauseAfterSeconds, splitReason, textSha256, runs }));
    const currentChunks = article.legacyChunks.map(chunk => ({ chunkIndex: chunk.chunkIndex, blockIndex: chunk.blockIndex, tag: chunk.tag, section: chunk.section,
      plannedPauseAfterSeconds: chunk.plannedPauseAfterSeconds, splitReason: chunk.splitReason, textSha256: sha256(chunk.text),
      runs: chunk.runs.map(run => ({ lang: run.lang, textSha256: sha256(run.text) })) }));
    const initialMetadata = Object.fromEntries([...NARRATABLE_METADATA, ...FRAMING_METADATA].filter(key => Object.hasOwn(initial.metadata ?? {}, key)).map(key => [key, initial.metadata[key]]));
    const currentMetadata = Object.fromEntries([...NARRATABLE_METADATA, ...FRAMING_METADATA].filter(key => Object.hasOwn(article.metadata ?? {}, key)).map(key => [key, article.metadata[key]]));
    const initialAssets = (initial.assets ?? []).filter(asset => !isArticleNavigationLink(asset));
    const currentAssets = (article.assets ?? []).filter(asset => !isArticleNavigationLink(asset));
    const diff = compareNarration({ editorialSentences: initialSentences, legacyChunks: initialChunks,
      structure: initial.structure, assets: initialAssets, metadata: initialMetadata,
      addedAt: initial.addedAt, order: initial.order },
    { editorialSentences: currentSentences, legacyChunks: currentChunks,
      structure: article.structure, assets: currentAssets, metadata: currentMetadata,
      addedAt: article.addedAt, order: article.order });
    return diff.changed ? [{ slug: article.slug, firstDivergence: diff.firstDivergence }] : [];
  });
  const missingFromCurrent = [...original.keys()].filter(slug => !currentSlugs.has(slug)).sort();
  return [...changes, ...missingFromCurrent.map(slug => ({ slug, kind: "missing-from-current-baseline" }))];
}

export function compareDomAgainstInitialBaseline(currentAudit, initialAudit) {
  const nativeSignatures = units => (units ?? []).map(({ blockIndex, sentenceIndex, sha256 }) => ({ blockIndex, sentenceIndex, sha256 }));
  const original = new Map((initialAudit.articles ?? []).map(article => [article.slug, article]));
  const currentArticles = currentAudit.articles ?? [];
  const currentSlugs = new Set(currentArticles.map(article => article.slug));
  const changes = currentArticles.flatMap(article => {
    const initial = original.get(article.slug);
    if (!initial) return [{ slug: article.slug, kind: "missing-in-initial-dom-baseline" }];
    const initialContract = { domUnitSignatures: nativeSignatures(initial.domUnitSignatures), mountedDomUnitSignatures: nativeSignatures(initial.mountedDomUnitSignatures),
      mountedCloneMatches: initial.mountedCloneMatches, chaptersSignature: initial.chaptersSignature, indexesMatch: initial.indexesMatch,
      domUnits: initial.domUnits, chapterUnits: initial.chapterUnits };
    const currentContract = { domUnitSignatures: nativeSignatures(article.domUnitSignatures), mountedDomUnitSignatures: nativeSignatures(article.mountedDomUnitSignatures),
      mountedCloneMatches: article.mountedCloneMatches, chaptersSignature: article.chaptersSignature, indexesMatch: article.indexesMatch,
      domUnits: article.domUnits, chapterUnits: article.chapterUnits };
    const difference = compareNarration(initialContract, currentContract);
    return difference.changed ? [{ slug: article.slug, firstDivergence: difference.firstDivergence }] : [];
  });
  const missingFromCurrent = [...original.keys()].filter(slug => !currentSlugs.has(slug)).sort();
  return [...changes, ...missingFromCurrent.map(slug => ({ slug, kind: "missing-from-current-dom-baseline" }))];
}

export function baselineCoverageBlockers({ baselineDrift = {}, domBaselineDrift = {} }) {
  const collect = (driftBySide, coveredKinds, kind, reason) => Object.entries(driftBySide).flatMap(([side, records]) =>
    records.filter(record => coveredKinds.has(record.kind)).map(({ slug }) => ({ slug, kind, side, reason })));
  return [
    ...collect(baselineDrift, new Set(["missing-in-initial-baseline", "missing-from-current-baseline"]),
      "baseline-coverage", "source inventory differs from the independent initial baseline"),
    ...collect(domBaselineDrift, new Set(["missing-in-initial-dom-baseline", "missing-from-current-dom-baseline"]),
      "dom-baseline-coverage", "DOM/chapter inventory differs from the independent initial baseline")
  ];
}

export function baselineReplayBlockers({ baseline, before, after, baselineDrift = {}, domBaselineDrift = {} }) {
  const original = new Map((baseline.articles ?? []).map(article => [article.slug, article]));
  return ["before", "after"].flatMap(side => {
    const current = side === "before" ? before : after;
    const replayedSlugs = new Set((current?.articles ?? []).flatMap(article => {
      const initial = original.get(article.slug);
      const sameSource = initial?.sourceBlob && initial.sourceBlob === article.sourceBlob;
      const sameBaselineRevision = current?.sha && current.sha === baseline.sha;
      return sameSource || sameBaselineRevision ? [article.slug] : [];
    }));
    const records = [
      ...(baselineDrift[side] ?? []).filter(record => replayedSlugs.has(record.slug) && record.firstDivergence)
        .map(record => ({ ...record, kind: "source-baseline-replay" })),
      ...(domBaselineDrift[side] ?? []).filter(record => replayedSlugs.has(record.slug) && record.firstDivergence)
        .map(record => ({ ...record, kind: "dom-baseline-replay" }))
    ];
    return records.map(({ slug, kind, firstDivergence }) => ({ slug, kind, side,
      reason: "unchanged independent-baseline source no longer reproduces its captured output", firstDivergence }));
  });
}

export function toolFingerprint(files) {
  return files.map(({ path, content }) => ({ path, sha256: sha256(content.replace(/\r\n/g, "\n")) }));
}
