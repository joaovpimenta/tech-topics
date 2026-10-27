export function migrationDomCatalogArticles(payload) {
  const articles = Array.isArray(payload) ? payload : payload?.articles;
  if (!Array.isArray(articles)) throw new Error("article catalog has no articles array");
  return articles;
}
