const params = new URLSearchParams(window.location.search);
const requestedSlug = params.get("slug");
const markArticlePerf = name => { try { performance.mark(`tt:${name}`); } catch (_) {} };
markArticlePerf("article-script-start");

const coverOverrides = {
  "retries-backoff-jitter": {
    src: "assets/retries-backoff-jitter/retries-backoff-jitter-cover.jpg",
    alt: "Três entregadores aparecem em tentativas sucessivas e cada vez mais espaçadas diante de uma porta de acesso; círculos e uma seta tracejados destacam a sequência."
  },
  "quoruns-de-leitura-e-escrita": {
    src: "assets/quoruns-de-leitura-e-escrita/quoruns-de-leitura-e-escrita-cover.jpg",
    alt: "Cinco caixas de arquivo sobre uma mesa; dois conjuntos tracejados se sobrepõem na caixa central, destacada como ponto comum entre os grupos."
  },
  "leases-e-fencing-tokens": {
    src: "assets/leases-e-fencing-tokens/leases-e-fencing-tokens-cover.jpg",
    alt: "Duas pessoas com credenciais de gerações diferentes diante de um controle de acesso; a credencial mais recente é destacada no leitor enquanto a antiga fica atrás."
  },
  "transactional-outbox": {
    src: "assets/transactional-outbox/transactional-outbox-cover.jpg",
    alt: "Uma pessoa registra um pacote em uma bandeja protegida antes de um mensageiro seguir até um veículo; marcações tracejadas destacam o pacote, a caixa de saída e o caminho de entrega."
  },
  "four-golden-signals": {
    src: "assets/four-golden-signals/four-golden-signals-cover.jpg",
    alt: "Fila de pessoas diante de um balcão, um pacote com problema e uma estante cheia; quatro marcações tracejadas destacam demanda, espera, falha e saturação."
  }
};

const coverFor = article => coverOverrides[article.slug] || {
  src: article.image,
  alt: article.alt || article.title
};

const articleActions = document.querySelector("#article-actions");
const shareButton = document.querySelector("#share-article");
const shareStatus = document.querySelector("#share-status");

const favoriteButton = document.querySelector("#favorite-article");
const FAVORITES_KEY = "tech-topics:favorites:v1";
let currentArticleSlug = "";
const fallbackFavorites = new Set();
function favoriteSlugs() {
  try {
    const values = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return new Set(Array.isArray(values) ? values.filter(value => typeof value === "string") : []);
  } catch (_) { return new Set(fallbackFavorites); }
}
function renderFavoriteButton() {
  if (!favoriteButton || !currentArticleSlug) return;
  const selected = favoriteSlugs().has(currentArticleSlug);
  favoriteButton.classList.toggle("is-favorite", selected);
  favoriteButton.setAttribute("aria-pressed", String(selected));
  favoriteButton.setAttribute("aria-label", selected ? "Remover artigo dos favoritos" : "Adicionar artigo aos favoritos");
  favoriteButton.title = selected ? "Remover dos favoritos" : "Adicionar aos favoritos";
}
favoriteButton?.addEventListener("click", () => {
  if (!currentArticleSlug) return;
  const updated = favoriteSlugs();
  if (updated.has(currentArticleSlug)) updated.delete(currentArticleSlug);
  else updated.add(currentArticleSlug);
  fallbackFavorites.clear();
  updated.forEach(slug => fallbackFavorites.add(slug));
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...updated])); }
  catch (_) { /* Persistência indisponível: mantém favoritos durante esta sessão. */ }
  renderFavoriteButton();
});
window.addEventListener("storage", event => {
  if (event.key === FAVORITES_KEY) renderFavoriteButton();
});


async function renderMermaidDiagrams() {
  const containers = [...document.querySelectorAll('[data-mermaid="true"]')];
  if (!containers.length) return;

  try {
    const mermaidConfig = window.TechTopicsMermaid;
    if (!mermaidConfig) throw new Error("Configuração Mermaid indisponível");
    const module = await import(mermaidConfig.moduleUrl);
    const mermaid = module.default;
    mermaid.initialize(mermaidConfig.config);

    for (const [index, container] of containers.entries()) {
      const source = container.querySelector(".mermaid-source");
      const code = source?.textContent?.trim();
      if (!code) continue;
      try {
        const rendered = await mermaid.render(`techTopicsDiagram${Date.now()}${index}`, code);
        const wrapper = document.createElement("div");
        wrapper.innerHTML = rendered.svg;
        const svg = wrapper.querySelector("svg");
        if (!svg) throw new Error("Mermaid não retornou SVG");
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", container.dataset.mermaidLabel || "Diagrama técnico");
        container.replaceChildren(svg);
      } catch (error) {
        container.classList.add("mermaid-error");
        const message = document.createElement("p");
        message.className = "mermaid-error-message";
        message.textContent = "Não foi possível renderizar este diagrama agora. O código permanece disponível abaixo.";
        container.append(message);
      }
    }
  } catch (error) {
    containers.forEach(container => {
      container.classList.add("mermaid-error");
      const message = document.createElement("p");
      message.className = "mermaid-error-message";
      message.textContent = "Mermaid não está disponível. O código permanece disponível abaixo.";
      container.append(message);
    });
  }
}

let shareData = null;

function renderSpeechMarkup(element, text, segments, defaultLanguage) {
  const validSegments = Array.isArray(segments)
    && segments.length > 0
    && segments.every(segment => segment && typeof segment.text === "string" && segment.text && typeof segment.lang === "string");
  if (!validSegments || segments.map(segment => segment.text).join("") !== text) {
    element.textContent = text;
    return;
  }

  element.replaceChildren();
  segments.forEach(segment => {
    if (segment.lang === defaultLanguage && !segment.speak && !segment.mode) {
      element.append(document.createTextNode(segment.text));
      return;
    }

    const span = document.createElement("span");
    span.lang = segment.lang;
    if (segment.speak) span.dataset.ttsSay = segment.speak;
    if (segment.mode) span.dataset.ttsMode = segment.mode;
    span.textContent = segment.text;
    element.append(span);
  });
}

async function copyShareLink(url) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = url;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Falha ao copiar link");
}

function setupShareControls(article) {
  if (!articleActions || !shareButton) return;

  articleActions.hidden = false;
  shareData = {
    title: `${article.title} — Tech Topics`,
    text: article.dek || article.excerpt || article.title,
    url: window.location.href
  };
  shareButton.hidden = false;
  shareButton.setAttribute("aria-label", `Compartilhar artigo: ${article.title}`);
  shareStatus.textContent = "";
}

shareButton?.addEventListener("click", async () => {
  if (!shareData) return;
  shareStatus.textContent = "";

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      shareStatus.textContent = "Artigo compartilhado.";
      return;
    }

    await copyShareLink(shareData.url);
    shareStatus.textContent = "Link copiado.";
  } catch (error) {
    if (error?.name === "AbortError") return;

    try {
      await copyShareLink(shareData.url);
      shareStatus.textContent = "Link copiado.";
    } catch (copyError) {
      shareStatus.textContent = "Não foi possível compartilhar este artigo.";
    }
  }
});

async function showArticle(article, htmlSlots = null) {
  document.documentElement.lang = article.language || "pt-BR";
  document.title = `${article.title} — Tech Topics`;
  document.querySelector("#article-description").content = article.excerpt;
  document.querySelector("#article-category").textContent = article.category;
  if (htmlSlots) {
    document.querySelector("#article-heading").innerHTML = htmlSlots.heading;
    document.querySelector("#article-dek").innerHTML = htmlSlots.dek;
  } else {
    renderSpeechMarkup(document.querySelector("#article-heading"), article.title, article.speechMarkup?.title, document.documentElement.lang);
    renderSpeechMarkup(document.querySelector("#article-dek"), article.dek || article.excerpt, article.speechMarkup?.dek, document.documentElement.lang);
  }
  const publishedAt = new Date(`${article.publishedAt}T00:00:00Z`);
  const date = Number.isNaN(publishedAt.getTime()) ? (article.date || "") : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "UTC" }).format(publishedAt);
  const details = [date];
  if (/\d/.test(article.read || "")) details.push(article.read);
  document.querySelector("#article-meta").textContent = details.filter(Boolean).join(" · ");
  const image = document.querySelector("#article-image");
  const cover = coverFor(article);
  image.src = cover.src;
  image.alt = cover.alt;
  document.querySelector(".article-hero").hidden = false;
  document.querySelector("#article-body").innerHTML = htmlSlots ? htmlSlots.body : article.bodyHtml;
  markArticlePerf("article-body-ready");
  void renderMermaidDiagrams();
  let lexicon = window.TechTopicsSpeechLexicon || {};
  let pronunciationUnavailable = !window.TechTopicsSpeechLexicon;
  try {
    lexicon = window.TechTopicsSpeech.validateLexicon(lexicon);
  } catch (error) {
    lexicon = {};
    pronunciationUnavailable = true;
  }
  let recordingPlayer = null;
  let devicePlayer = null;
  let voiceAvailability = null;
  function renderVoiceAvailability(snapshot) {
    if (pronunciationUnavailable || devicePlayer?.snapshot().state !== "idle") return;
    const message = snapshot.state === "pending"
      ? "Preparando as vozes do dispositivo."
      : snapshot.state === "unavailable"
        ? "Nenhuma voz do dispositivo foi disponibilizada; a narração gravada continua disponível."
        : snapshot.state === "missing-pt-br"
          ? "Nenhuma voz em português foi encontrada; o navegador pode usar outra voz disponível."
          : "";
    document.querySelector("#listen-status").textContent = message;
  }
  devicePlayer = window.TechTopicsSpeech.mount({
    document, lexicon, dockMode: true,
    onStatus: snapshot => recordingPlayer?.deviceChanged(snapshot),
    onAvailability: snapshot => {
      voiceAvailability = snapshot;
      renderVoiceAvailability(snapshot);
    }
  });
  if (voiceAvailability) renderVoiceAvailability(voiceAvailability);
  recordingPlayer = window.TechTopicsAudio.createPlayer({
    document,
    navigator,
    article,
    cover,
    audio: document.querySelector("#article-recording"),
    devicePlayer,
    startDevice: () => {
      document.querySelector("#recording-status").textContent = "O navegador não oferece leitura por voz.";
    }
  });
  void recordingPlayer.discover();
  if (pronunciationUnavailable) document.querySelector("#listen-status").textContent = "Pronúncias personalizadas indisponíveis; siglas serão soletradas.";
  currentArticleSlug = article.slug;
  renderFavoriteButton();
  setupShareControls(article);
  document.dispatchEvent(new Event("tech-topics:article-ready"));
  markArticlePerf("article-controls-ready");
}

function articleHtmlSlots(source, slug, transport) {
  const parsed = new DOMParser().parseFromString(source, "text/html");
  const envelopes = parsed.querySelectorAll("article[data-article-format]");
  if (envelopes.length !== 1) throw new Error("Envelope HTML inválido");
  const envelope = envelopes[0];
  if (envelope.dataset.articleFormat !== "html-v1"
    || envelope.dataset.articleSlug !== slug
    || envelope.dataset.buildId !== transport.buildId) {
    throw new Error("Identidade HTML inválida");
  }

  const allSlots = envelope.querySelectorAll("[data-article-slot]");
  const slots = {};
  for (const name of ["heading", "dek", "body"]) {
    const matches = envelope.querySelectorAll(`[data-article-slot="${name}"]`);
    if (matches.length !== 1 || !matches[0].textContent.trim()) throw new Error(`Slot HTML inválido: ${name}`);
    slots[name] = matches[0];
  }
  if (allSlots.length !== 3
    || slots.heading.tagName !== "H1"
    || slots.dek.tagName !== "P"
    || slots.body.tagName !== "SECTION"
    || Object.values(slots).some(parent => Object.values(slots).some(child => parent !== child && parent.contains(child)))) {
    throw new Error("Estrutura HTML inválida");
  }
  return Object.fromEntries(Object.entries(slots).map(([name, element]) => [name, element.innerHTML]));
}

async function loadHtmlFallback(slug, catalogArticle = null) {
  let article = catalogArticle;
  if (!article) {
    const catalogResponse = await fetch("assets/articles-catalog.json", { cache: "no-store" });
    if (!catalogResponse.ok) throw new Error("Catálogo indisponível");
    const catalog = await catalogResponse.json();
    if (!Array.isArray(catalog)) throw new Error("Catálogo inválido");
    article = catalog.find(item => item?.slug === slug);
  }
  if (!article) throw new Error("Artigo ausente no catálogo");
  if (article.slug !== slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug)) {
    throw new Error("Slug inválido no catálogo");
  }

  const transport = article.transport;
  const expectedPath = `content/articles/${slug}.html`;
  if (!transport
    || transport.format !== "html-v1"
    || transport.path !== expectedPath
    || typeof transport.buildId !== "string"
    || !transport.buildId.trim()) {
    throw new Error("Transporte HTML ausente ou inválido");
  }
  if (![article.title, article.category, article.excerpt, article.image].every(value => typeof value === "string" && value.trim())) {
    throw new Error("Metadados HTML inválidos");
  }

  const htmlResponse = await fetch(transport.path, { cache: "no-store" });
  if (!htmlResponse.ok) throw new Error("Artigo HTML indisponível");
  const slots = articleHtmlSlots(await htmlResponse.text(), slug, transport);
  return { article, slots };
}

async function loadHtmlFromCatalog(requestedArticleSlug) {
  const catalogResponse = await fetch("assets/articles-catalog.json", { cache: "no-store" });
  if (!catalogResponse.ok) throw new Error("Catálogo indisponível");
  const catalog = await catalogResponse.json();
  if (!Array.isArray(catalog) || !catalog.length) throw new Error("Catálogo inválido");
  const article = requestedArticleSlug
    ? catalog.find(item => item?.slug === requestedArticleSlug)
    : catalog[0];
  if (!article) throw new Error("Artigo ausente no catálogo");
  return loadHtmlFallback(article.slug, article);
}

async function loadArticle() {
  try {
    const manifestResponse = await fetch("content/articles/index.json", { cache: "no-store" });
    if (manifestResponse.status === 404) {
      const { article, slots } = await loadHtmlFromCatalog(requestedSlug);
      await showArticle(article, slots);
      return;
    }
    if (!manifestResponse.ok) throw new Error("Manifesto indisponível");
    const manifest = await manifestResponse.json();
    const entry = requestedSlug ? manifest.find(item => item.slug === requestedSlug) : manifest[0];
    if (!entry || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug)
      || entry.path !== `content/articles/${entry.slug}.json`) throw new Error("Artigo não encontrado");
    const articleResponse = await fetch(entry.path, { cache: "no-store" });
    if (articleResponse.status === 404) {
      const { article, slots } = await loadHtmlFallback(entry.slug);
      await showArticle(article, slots);
      return;
    }
    if (!articleResponse.ok) throw new Error("Artigo indisponível");
    const article = await articleResponse.json();
    if (article?.slug !== entry.slug) throw new Error("Identidade JSON inválida");
    await showArticle(article);
  } catch (error) {
    document.querySelector("#article-category").textContent = "Arquivo";
    document.querySelector("#article-heading").textContent = "Artigo indisponível";
    document.querySelector(".article-hero").hidden = true;
    document.querySelector("#article-actions").hidden = true;
    document.querySelector("#article-body").innerHTML = "<p>Não foi possível carregar este artigo. Volte ao arquivo e tente novamente.</p><p><a class=\"article-back\" href=\"index.html#recent-posts\">← Todos os artigos</a></p>";
  }
}

loadArticle();
