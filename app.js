const articles = [];
const list = document.querySelector("#recent-list");
const searchInput = document.querySelector("#search-input");
const count = document.querySelector("#article-count");
const status = document.querySelector("#archive-status");
const emptyState = document.querySelector("#empty-state");
const loadMore = document.querySelector("#load-more");
const quickActions = document.querySelector("#article-quick-actions");
const shareStatus = document.querySelector("#share-status");
const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
const BATCH_SIZE = 6;
let visibleCount = BATCH_SIZE;
let observer;
let matching = [];
const { articleCard } = window.TechTopicsCards.createCards({ quickActions, shareStatus });

function renderBatch() {
  const from = list.children.length;
  const next = matching.slice(from, from + BATCH_SIZE);
  list.append(...next.map((article, i) => articleCard(article, from + i)));
  visibleCount = list.children.length;
  loadMore.hidden = visibleCount >= matching.length;
  list.setAttribute("aria-busy", "false");
}

function renderArchive() {
  const query = normalize(searchInput.value.trim());
  matching = articles.filter(article => {
    const tags = [...(article.tags || []), ...(article.tagLabels || [])];
    const metadata = [article.level, article.series, ...(article.prerequisites || [])];
    return normalize([article.title, article.category, article.excerpt, article.dek, ...tags, ...metadata].join(" ")).includes(query);
  });
  list.replaceChildren();
  visibleCount = 0;
  count.textContent = query
    ? matching.length + " de " + articles.length + " artigos"
    : articles.length + " artigos · mais recentes primeiro";
  emptyState.hidden = matching.length > 0 || articles.length === 0;
  if (articles.length) renderBatch();
  else loadMore.hidden = true;
}

async function loadArticles() {
  try {
    const response = await fetch("assets/articles-catalog.json");
    if (!response.ok) throw new Error("Catálogo indisponível");
    const catalog = await response.json();
    const records = articleCatalogEntries(catalog);
    const valid = records.filter(article => article && typeof article.slug === "string" && typeof article.title === "string" && typeof article.image === "string");
    if (valid.length !== records.length) throw new Error("Catálogo incompleto");
    articles.splice(0, articles.length, ...valid);
    articles.sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")) ||
      (Date.parse(b.addedAt) || 0) - (Date.parse(a.addedAt) || 0) || a.slug.localeCompare(b.slug));
    renderArchive();
    if (!articles.length) {
      count.textContent = "0 artigos";
      emptyState.textContent = "Ainda não há artigos publicados.";
      emptyState.hidden = false;
    }
  } catch (error) {
    count.textContent = "Arquivo indisponível";
    status.textContent = "Não foi possível carregar o catálogo. Recarregue a página para tentar novamente.";
    status.hidden = false;
    emptyState.hidden = true;
  } finally { list.setAttribute("aria-busy", "false"); }
}

function articleCatalogEntries(catalog) {
  if (!catalog || typeof catalog !== "object" || catalog.version !== 1
    || catalog.transport !== "html-v1"
    || !/^[a-f0-9]{40}$/i.test(catalog.sourceSha || "")
    || !/^[a-f0-9]{64}$/.test(catalog.buildId || "")
    || !Array.isArray(catalog.articles) || !catalog.articles.length) {
    throw new Error("Catálogo inválido");
  }
  const slugs = new Set();
  for (const article of catalog.articles) {
    if (typeof article?.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug)
      || slugs.has(article.slug) || article.format !== "html-v1"
      || article.path !== `content/articles/${article.slug}.html`
      || Object.hasOwn(article, "bodyHtml") || Object.hasOwn(article, "html")
      || !Array.isArray(article.tags) || !Array.isArray(article.tagLabels)) {
      throw new Error("Registro HTML inválido no catálogo");
    }
    slugs.add(article.slug);
  }
  return catalog.articles;
}

searchInput.addEventListener("input", renderArchive);
loadMore.addEventListener("click", renderBatch);
if ("IntersectionObserver" in window) {
  observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting) && !loadMore.hidden) renderBatch();
  }, { rootMargin: "450px" });
  observer.observe(loadMore);
}
const initialQuery = new URLSearchParams(window.location.search).get("q");
if (initialQuery) searchInput.value = initialQuery;
loadArticles();
