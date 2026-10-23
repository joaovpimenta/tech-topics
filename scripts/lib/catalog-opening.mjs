// The published catalog contains display text, not the full article markup.
// Articles validated by lint-articles.mjs start with their opening <p>.
const NAMED_ENTITIES = Object.freeze({
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  rarr: "→", larr: "←", harr: "↔", times: "×",
  le: "≤", ge: "≥", middot: "·"
});

function decodeEntity(entity) {
  if (entity[0] === "#") {
    const hex = /^#x/i.test(entity);
    const digits = entity.slice(hex ? 2 : 1);
    const radix = hex ? 16 : 10;
    if (!new RegExp(hex ? "^[0-9a-f]+$" : "^[0-9]+$", "i").test(digits)) return "&" + entity + ";";
    const point = Number.parseInt(digits, radix);
    if (point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)) {
      return String.fromCodePoint(point);
    }
    return "�";
  }
  return NAMED_ENTITIES[entity] ?? NAMED_ENTITIES[entity.toLowerCase()] ?? "&" + entity + ";";
}

/** Extract the *displayed* opening allegory, retaining every sentence. */
export function extractOpeningParagraph(bodyHtml) {
  if (typeof bodyHtml !== "string") return "";
  const match = bodyHtml.match(/^\s*<p\b[^>]*>([\s\S]*?)<\/p\s*>/i);
  if (!match) return "";
  return match[1]
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/gi, (_, entity) => decodeEntity(entity))
    .replace(/\s+/g, " ")
    .trim();
}
