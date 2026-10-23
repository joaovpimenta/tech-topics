const articles = [];
const list = document.querySelector("#recent-list");
const searchInput = document.querySelector("#search-input");
const count = document.querySelector("#article-count");
const status = document.querySelector("#archive-status");
const emptyState = document.querySelector("#empty-state");
const loadMore = document.querySelector("#load-more");
const favoritesOnly = document.querySelector("#favorites-only");
const preview = document.querySelector("#article-preview");
const previewBody = document.querySelector("#preview-body");
const shareStatus = document.querySelector("#share-status");
const starCount = document.querySelector("#github-stars");
const articleUrl = article => "article.html?slug=" + encodeURIComponent(article.slug);
const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
const FAVORITES_KEY = "tech-topics:favorites:v1";
const BATCH_SIZE = 6;
let visibleCount = BATCH_SIZE;
let observer;
let matching = [];

function readFavorites() {
  try {
    const values = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return new Set(Array.isArray(values) ? values.filter(value => typeof value === "string") : []);
  } catch (_) { return new Set(); }
}
const favorites = readFavorites();

function toggleFavorite(slug, button) {
  if (favorites.has(slug)) favorites.delete(slug);
  else favorites.add(slug);
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites])); }
  catch (_) { /* Private browsing or full storage: keep the in-memory selection. */ }
  if (favoritesOnly.checked) renderArchive();
  else if (button) {
    const selected = favorites.has(slug);
    button.classList.toggle("is-favorite", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute("aria-label", (selected ? "Remover dos favoritos: " : "Adicionar aos favoritos: ") + button.dataset.articleTitle);
    button.title = selected ? "Remover dos favoritos" : "Adicionar aos favoritos";
  }
}

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function icon(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "19");
  svg.setAttribute("height", "19");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", kind === "heart"
    ? "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"
    : "M12 16V3m0 0L7 8m5-5 5 5M5 13v5a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-5");
  svg.append(path);
  return svg;
}

function dateLabel(article) {
  const date = new Date(String(article.publishedAt || "") + "T00:00:00Z");
  return Number.isNaN(date.getTime()) ? (article.date || "") : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function openPreview(article) {
  if (!preview || !previewBody || typeof preview.showModal !== "function") return;
  const cover = element("img", "preview-image");
  cover.src = article.image;
  cover.alt = article.alt || "";
  cover.loading = "lazy";
  const category = element("p", "eyebrow", article.category);
  const heading = element("h2", "", article.title);
  heading.id = "preview-heading";
  const dek = element("p", "preview-summary", article.dek || article.excerpt || "");
  const excerpt = article.dek && article.excerpt && article.dek !== article.excerpt
    ? element("p", "preview-excerpt", article.excerpt) : null;
  const meta = element("p", "post-meta", [dateLabel(article), article.read].filter(Boolean).join(" · "));
  const read = element("a", "preview-read", "Ler artigo");
  read.href = articleUrl(article);
  previewBody.replaceChildren(...[cover, category, heading, dek, excerpt, meta, read].filter(Boolean));
  preview.showModal();
}

async function shareArticle(article) {
  const url = new URL(articleUrl(article), document.baseURI).href;
  try {
    if (navigator.share) {
      await navigator.share({ title: article.title, url });
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
      shareStatus.textContent = "Link do artigo copiado.";
    } else {
      window.prompt("Copie o link do artigo:", url);
    }
  } catch (error) {
    if (error.name !== "AbortError") shareStatus.textContent = "Não foi possível compartilhar este artigo.";
  }
}

function articleCard(article, index) {
  const card = element("article", "recent-item");
  card.tabIndex = 0;
  card.title = "Toque e segure ou pressione Espaço para ver uma prévia";
  const imageLink = element("a", "recent-image image-link");
  imageLink.href = articleUrl(article);
  imageLink.setAttribute("aria-label", "Ler " + article.title);
  const image = element("img");
  image.src = article.image;
  image.alt = article.alt || article.title;
  image.loading = index < 2 ? "eager" : "lazy";
  image.decoding = "async";
  if (index === 0) image.fetchPriority = "high";
  imageLink.append(image);

  const copy = element("div", "recent-copy");
  const category = element("p", "eyebrow", article.category);
  const title = element("h3");
  const titleLink = element("a", "", article.title);
  titleLink.href = articleUrl(article);
  title.append(titleLink);
  copy.append(category, title, element("p", "excerpt", article.excerpt || article.dek || ""),
    element("p", "post-meta", [dateLabel(article), article.read].filter(Boolean).join(" · ")));

  const actions = element("div", "card-actions");
  const like = element("button", "card-icon-button favorite-button");
  const selected = favorites.has(article.slug);
  like.type = "button";
  like.dataset.articleTitle = article.title;
  like.setAttribute("aria-label", (selected ? "Remover dos favoritos: " : "Adicionar aos favoritos: ") + article.title);
  like.setAttribute("aria-pressed", String(selected));
  like.title = selected ? "Remover dos favoritos" : "Adicionar aos favoritos";
  if (selected) like.classList.add("is-favorite");
  like.append(icon("heart"));
  like.addEventListener("click", () => toggleFavorite(article.slug, like));

  const share = element("button", "card-icon-button");
  share.type = "button";
  share.setAttribute("aria-label", "Compartilhar " + article.title);
  share.title = "Compartilhar";
  share.append(icon("share"));
  share.addEventListener("click", () => shareArticle(article));
  actions.append(like, share);
  card.append(imageLink, copy, actions);

  let timer;
  let startX = 0;
  let startY = 0;
  let suppressClick = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  card.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    if (event.target.closest("button")) return;
    cancel();
    startX = event.clientX;
    startY = event.clientY;
    timer = setTimeout(() => {
      timer = null;
      suppressClick = true;
      openPreview(article);
      setTimeout(() => { suppressClick = false; }, 850);
    }, 550);
  });
  card.addEventListener("contextmenu", event => { if (event.pointerType === "touch") event.preventDefault(); });
  card.addEventListener("pointermove", event => {
    if (Math.abs(event.clientX - startX) > 12 || Math.abs(event.clientY - startY) > 12) cancel();
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) card.addEventListener(type, cancel);
  card.addEventListener("click", event => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  card.addEventListener("keydown", event => {
    if (event.target === card && (event.key === " " || event.key === "Enter")) {
      event.preventDefault();
      openPreview(article);
    }
  });
  return card;
}

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
  matching = articles.filter(article =>
    (!favoritesOnly.checked || favorites.has(article.slug)) &&
    normalize([article.title, article.category, article.excerpt, article.dek].join(" ")).includes(query)
  );
  list.replaceChildren();
  visibleCount = 0;
  count.textContent = (query || favoritesOnly.checked)
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
    if (!Array.isArray(catalog)) throw new Error("Catálogo inválido");
    const valid = catalog.filter(article => article && typeof article.slug === "string" && typeof article.title === "string" && typeof article.image === "string");
    if (valid.length !== catalog.length) throw new Error("Catálogo incompleto");
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

async function loadGithubStars() {
  if (!starCount) return;
  const key = "tech-topics:github-stars:v1";
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (saved && Number.isInteger(saved.stars)) {
      starCount.textContent = new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(saved.stars);
      if (Date.now() - saved.updated < 6 * 60 * 60 * 1000) return;
    }
  } catch (_) { /* Continue without cached data. */ }
  try {
    const response = await fetch("https://api.github.com/repos/joaovpimenta/tech-topics", { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) return;
    const data = await response.json();
    if (!Number.isInteger(data.stargazers_count)) return;
    starCount.textContent = new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(data.stargazers_count);
    try { localStorage.setItem(key, JSON.stringify({ stars: data.stargazers_count, updated: Date.now() })); }
    catch (_) {}
  } catch (_) { /* GitHub API is best-effort and never blocks the home. */ }
}

searchInput.addEventListener("input", renderArchive);
favoritesOnly.addEventListener("change", renderArchive);
loadMore.addEventListener("click", renderBatch);
preview?.querySelector(".preview-close")?.addEventListener("click", () => preview.close());
preview?.addEventListener("click", event => {
  if (event.target === preview) preview.close();
});
if ("IntersectionObserver" in window) {
  observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting) && !loadMore.hidden) renderBatch();
  }, { rootMargin: "450px" });
  observer.observe(loadMore);
}
const initialQuery = new URLSearchParams(window.location.search).get("q");
if (initialQuery) searchInput.value = initialQuery;
loadArticles();
loadGithubStars();
