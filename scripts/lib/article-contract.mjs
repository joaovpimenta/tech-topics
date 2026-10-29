const requiredFields = Object.freeze({
  slug: "string",
  language: "string",
  title: "string",
  category: "string",
  date: "string",
  publishedAt: "string",
  read: "string",
  image: "string",
  alt: "string",
  dek: "string",
  excerpt: "string",
  bodyHtml: "string"
});

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SVG_PATTERN = /<svg\b|\.svg(?:["')?#]|$)/i;

function isArticleObject(article) {
  return article !== null && typeof article === "object" && !Array.isArray(article);
}

export function validateSpeechDirective(attrs) {
  const failures = [];
  const mode = attrs["data-tts-mode"] ?? attrs.mode;
  const speak = attrs["data-tts-say"] ?? attrs.speak;
  if (mode !== undefined && !["spell", "word"].includes(mode)) failures.push("TTS mode must be spell or word");
  if (speak !== undefined && (typeof speak !== "string" || !speak.trim())) failures.push("TTS speak must be non-empty text");
  if (mode !== undefined && speak !== undefined) failures.push("TTS speak and mode are mutually exclusive");
  return failures;
}

function validateSpeechMarkup(article, fail) {
  if (article.speechMarkup === undefined) return;
  if (!article.speechMarkup || typeof article.speechMarkup !== "object" || Array.isArray(article.speechMarkup)) {
    fail("speechMarkup must be an object");
    return;
  }

  for (const field of ["title", "dek"]) {
    const segments = article.speechMarkup[field];
    if (segments === undefined) continue;
    if (!Array.isArray(segments)) {
      fail(`speechMarkup.${field} must be an array`);
      continue;
    }

    const expectedText = field === "title" ? article.title : (article.dek || article.excerpt);
    const segmentText = [];
    for (const [index, segment] of segments.entries()) {
      if (!segment || typeof segment !== "object" || typeof segment.text !== "string" || !segment.text) {
        fail(`speechMarkup.${field}[${index}] must contain non-empty text`);
        continue;
      }
      if (typeof segment.lang !== "string" || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(segment.lang)) {
        fail(`speechMarkup.${field}[${index}] must contain a valid lang`);
      }
      for (const message of validateSpeechDirective(segment)) fail(message);
      segmentText.push(segment.text);
    }

    if (segmentText.join("") !== expectedText) {
      fail(`speechMarkup.${field} text must exactly match the displayed ${field}`);
    }
  }
}

function validateArticleRecord(file, article) {
  const failures = [];
  const fail = message => failures.push({ file, message });

  if (!isArticleObject(article)) {
    fail("article must be an object");
    return failures;
  }

  for (const [field, type] of Object.entries(requiredFields)) {
    if (typeof article[field] !== type || !article[field].trim()) {
      fail("missing or invalid field: " + field);
    }
  }

  if (typeof article.slug === "string") {
    if (!SLUG_PATTERN.test(article.slug)) fail("slug must be lowercase kebab-case");
    const normalizedFile = file.replace(/\\/g, "/");
    const sourceName = normalizedFile.slice(normalizedFile.lastIndexOf("/") + 1);
    const v2Slug = normalizedFile.match(/^articles\/([a-z0-9]+(?:-[a-z0-9]+)*)\/article\.md$/)?.[1];
    const sourceSlug = v2Slug ?? sourceName.replace(/\.md$/i, "");
    if ((!v2Slug && sourceSlug === sourceName) || article.slug !== sourceSlug) fail("slug must match the source filename");
  }
  if (typeof article.language === "string" && article.language !== "pt-BR") {
    fail("language must be pt-BR");
  }
  if (typeof article.publishedAt === "string" && (
    !/^\d{4}-\d{2}-\d{2}$/.test(article.publishedAt) ||
    Number.isNaN(Date.parse(article.publishedAt)) ||
    new Date(article.publishedAt).toISOString().slice(0, 10) !== article.publishedAt
  )) {
    fail("publishedAt must be a valid ISO YYYY-MM-DD date");
  }
  if (typeof article.bodyHtml === "string" && SVG_PATTERN.test(article.bodyHtml)) {
    fail("technical visuals must not use SVG");
  }
  if (typeof article.bodyHtml === "string" && /\b(?:href|src)\s*=\s*(?:"[^"\r\n]*<|'[^'\r\n]*<)/i.test(article.bodyHtml)) {
    fail("URL attributes must not contain HTML markup; pronunciation spans belong in displayed text");
  }
  if (typeof article.slug === "string" && typeof article.image === "string") {
    const expectedImage = `assets/${article.slug}/${article.slug}-cover.jpg`;
    if (article.image !== expectedImage) fail("image must point to " + expectedImage);
  }

  validateSpeechMarkup(article, fail);
  return failures;
}

export function validateArticleCatalog(articles) {
  const failures = [];
  const slugs = new Set();
  const titles = new Set();
  const coverPaths = new Set();

  for (const { file, article } of articles) {
    failures.push(...validateArticleRecord(file, article));
    if (!isArticleObject(article)) continue;

    if (typeof article.slug === "string" && article.slug.trim()) {
      if (slugs.has(article.slug)) failures.push({ file, message: "duplicate article slug: " + article.slug });
      slugs.add(article.slug);
    }
    if (typeof article.title === "string" && article.title.trim()) {
      const title = article.title.trim().toLocaleLowerCase("pt-BR");
      if (titles.has(title)) failures.push({ file, message: "duplicate article title" });
      titles.add(title);
    }
    if (typeof article.image === "string" && article.image.trim()) {
      if (coverPaths.has(article.image)) failures.push({ file, message: "cover image is reused by another article" });
      coverPaths.add(article.image);
    }
  }

  return failures;
}
