const articles = [];
const list = document.querySelector("#recent-list");
const searchInput = document.querySelector("#search-input");
const count = document.querySelector("#article-count");
const status = document.querySelector("#archive-status");
const emptyState = document.querySelector("#empty-state");
const articleUrl = article => `article.html?slug=${encodeURIComponent(article.slug)}`;
const normalize = text => String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

const coverOverrides = {
  "retries-backoff-jitter": {
    src: "assets/retries-backoff-jitter-cover.svg",
    alt: "Três entregadores aparecem em tentativas sucessivas e cada vez mais espaçadas diante de uma porta de acesso; círculos e uma seta tracejados destacam a sequência."
  },
  "quoruns-de-leitura-e-escrita": {
    src: "assets/quoruns-de-leitura-e-escrita-cover.svg",
    alt: "Cinco caixas de arquivo sobre uma mesa; dois conjuntos tracejados se sobrepõem na caixa central, destacada como ponto comum entre os grupos."
  },
  "leases-e-fencing-tokens": {
    src: "assets/leases-e-fencing-tokens-cover.svg",
    alt: "Duas pessoas com credenciais de gerações diferentes diante de um controle de acesso; a credencial mais recente é destacada no leitor enquanto a antiga fica atrás."
  },
  "transactional-outbox": {
    src: "assets/transactional-outbox-cover.svg",
    alt: "Uma pessoa registra um pacote em uma bandeja protegida antes de um mensageiro seguir até um veículo; marcações tracejadas destacam o pacote, a caixa de saída e o caminho de entrega."
  },
  "four-golden-signals": {
    src: "assets/four-golden-signals-cover.svg",
    alt: "Fila de pessoas diante de um balcão, um pacote com problema e uma estante cheia; quatro marcações tracejadas destacam demanda, espera, falha e saturação."
  }
};

const coverFor = article => coverOverrides[article.slug] || {
  src: article.image,
  alt: article.alt || article.title
};

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
  const cover = coverFor(article);
  image.src = cover.src;
  image.alt = cover.alt;
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
      article.addedAt = entry.addedAt || "";
      return article;
    }));
    articles.splice(0, articles.length, ...results.filter(result => result.status === "fulfilled").map(result => result.value));
    articles.sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")) || (Date.parse(b.addedAt) || 0) - (Date.parse(a.addedAt) || 0) || a.slug.localeCompare(b.slug));
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
