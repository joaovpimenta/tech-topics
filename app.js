const articles = [];
const list = document.querySelector("#recent-list");
const searchInput = document.querySelector("#search-input");
const count = document.querySelector("#article-count");
const status = document.querySelector("#archive-status");
const emptyState = document.querySelector("#empty-state");
const articleUrl = article => `article.html?slug=${encodeURIComponent(article.slug)}`;
const normalize = text => String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

function publicationDate(article) {
  const date = new Date(`${article.publishedAt}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? (article.date || "") : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function articleCard(article) {
  const card = element("article", "recent-item");
  const imageLink = element("a", "recent-image image-link");
  imageLink.href = articleUrl(article);
  imageLink.setAttribute("aria-label", `Ler ${article.title}`);
  const image = element("img", "");
  image.src = article.image;
  image.alt = article.alt || article.title;
  image.loading = "lazy";
  image.decoding = "async";
  imageLink.append(image);
  const copy = element("div", "recent-copy");
  const category = element("p", "eyebrow", article.category);
  const title = element("h3", "");
  const titleLink = element("a", "", article.title);
  titleLink.href = articleUrl(article);
  title.append(titleLink);
  const excerpt = element("p", "excerpt", article.excerpt);
  const details = [publicationDate(article)];
  if (/\d/.test(article.read || "")) details.push(article.read);
  copy.append(category, title, excerpt, element("p", "post-meta", details.filter(Boolean).join(" · ")));
  card.append(imageLink, copy);
  return card;
}

function renderArchive() {
  const query = normalize(searchInput.value.trim());
  const matches = articles.filter(article => normalize(`${article.title} ${article.category} ${article.excerpt}`).includes(query));
  list.replaceChildren(...matches.map(articleCard));
  count.textContent = query
    ? `${matches.length} de ${articles.length} artigo${articles.length === 1 ? "" : "s"}`
    : `${articles.length} artigo${articles.length === 1 ? "" : "s"} · mais recentes primeiro`;
  emptyState.hidden = matches.length > 0;
}

async function loadArticles() {
  try {
    const response = await fetch("content/articles/index.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Manifesto indisponível");
    const manifest = await response.json();
    if (!Array.isArray(manifest)) throw new Error("Manifesto inválido");
    const results = await Promise.allSettled(manifest.map(async entry => {
      const articleResponse = await fetch(entry.path, { cache: "no-store" });
      if (!articleResponse.ok) throw new Error(`Artigo indisponível: ${entry.slug}`);
      const article = await articleResponse.json();
      if (article.slug !== entry.slug) throw new Error("Slug diferente do manifesto");
      return article;
    }));
    articles.splice(0, articles.length, ...results.filter(result => result.status === "fulfilled").map(result => result.value));
    articles.sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")) || a.slug.localeCompare(b.slug));
    renderArchive();
    const failures = results.filter(result => result.status === "rejected").length;
    if (failures) {
      status.textContent = "Alguns artigos não puderam ser carregados. Recarregue a página para tentar novamente.";
      status.hidden = false;
    }
    if (!manifest.length) emptyState.textContent = "Ainda não há artigos publicados.";
  } catch (error) {
    count.textContent = "Arquivo indisponível";
    status.textContent = "Não foi possível carregar os artigos. Recarregue a página para tentar novamente.";
    status.hidden = false;
    emptyState.hidden = true;
  } finally {
    list.setAttribute("aria-busy", "false");
  }
}

searchInput.addEventListener("input", renderArchive);
loadArticles();
