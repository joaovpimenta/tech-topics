const params = new URLSearchParams(window.location.search);
const siteBase = window.TechTopicsSiteBase || "./";
// The publication SHA is embedded in each built shell. A unique URL prevents a
// previous Service Worker from returning a catalog/HTML envelope from another build.
const publicationRevision = window.TechTopicsPublicationSha;
const publicationQuery = /^[a-f0-9]{40}$/i.test(publicationRevision || "")
  ? "?revision=" + encodeURIComponent(publicationRevision)
  : "?transport=html-v1";
const requestedSlug = document.body?.dataset?.articleSlug || params.get("slug");
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


function mountDiagramViewport(container, svg) {
  const viewBox = svg.viewBox.baseVal;
  if (!(viewBox.width > 0 && viewBox.height > 0)) return;
  const viewport = document.createElement("div");
  viewport.className = "diagram-viewport";
  viewport.tabIndex = 0;
  viewport.setAttribute("role", "region");
  viewport.setAttribute("aria-label", svg.getAttribute("aria-label") + ". Use as setas para rolar o diagrama ampliado.");
  const toolbar = document.createElement("div");
  toolbar.className = "diagram-toolbar";
  toolbar.setAttribute("data-tts-ignore", "");
  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", "Tamanho do diagrama");
  function button(text, label, action) {
    const control = document.createElement("button");
    control.type = "button";
    control.textContent = text;
    control.setAttribute("aria-label", label);
    control.title = label;
    control.addEventListener("click", action);
    toolbar.append(control);
    return control;
  }
  let scale = 1;
  let mode = "auto";
  let fit = 1;
  let maximum = 3;
  const zoomIn = button("+", "Ampliar diagrama", () => zoom(scale * 1.25));
  const zoomOut = button("−", "Reduzir diagrama", () => zoom(scale / 1.25));
  let dialog = null;
  const fullscreen = button("⛶", "Abrir diagrama em tela cheia", () => {
    if (dialog) { dialog.close(); return; }
    const readingPosition = { top: window.scrollY, left: window.scrollX, behavior: "instant" };
    const placeholder = document.createComment("diagram-position");
    container.before(placeholder);
    dialog = document.createElement("dialog");
    dialog.className = "diagram-dialog";
    dialog.setAttribute("aria-label", "Diagrama em tela cheia");
    document.body.append(dialog);
    dialog.append(container);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    fullscreen.setAttribute("aria-label", "Sair da tela cheia");
    fullscreen.title = "Sair da tela cheia";
    dialog.addEventListener("close", () => {
      placeholder.replaceWith(container);
      dialog.remove();
      dialog = null;
      document.body.style.overflow = previousOverflow;
      fullscreen.setAttribute("aria-label", "Abrir diagrama em tela cheia");
      fullscreen.title = "Abrir diagrama em tela cheia";
      update();
      window.scrollTo(readingPosition);
      fullscreen.focus({ preventScroll: true });
    }, { once: true });
    dialog.showModal();
    fullscreen.focus();
    update();
  });
  const status = document.createElement("output");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-label", "Ampliação do diagrama");
  toolbar.append(status);
  const hint = document.createElement("p");
  hint.className = "diagram-hint";
  hint.setAttribute("data-tts-ignore", "");
  hint.textContent = "Deslize dentro do quadro para explorar o diagrama ampliado.";
  viewport.append(svg);
  svg.style.maxWidth = "none";
  container.replaceChildren(toolbar, viewport, hint);
  const fonts = [...svg.querySelectorAll("text, foreignObject span, foreignObject p")]
    .filter(node => node.textContent.trim())
    .map(node => parseFloat(getComputedStyle(node).fontSize)).filter(size => size > 0);
  function update() {
    const width = viewport.clientWidth;
    if (!width) return;
    const minimumFont = Math.max(14, parseFloat(getComputedStyle(document.documentElement).fontSize) * .875);
    const readableScale = minimumFont / (fonts.length ? Math.min(...fonts) : 16);
    fit = Math.min(1, width / viewBox.width);
    maximum = Math.max(3, readableScale * 2);
    if (mode === "auto") scale = Math.max(fit, readableScale);
    else if (mode === "fit") scale = fit;
    else scale = Math.max(fit, Math.min(maximum, scale));
    svg.style.width = `${viewBox.width * scale}px`;
    svg.style.height = `${viewBox.height * scale}px`;
    zoomIn.disabled = scale >= maximum - .001;
    zoomOut.disabled = scale <= fit + .001;
    status.value = `${Math.round(scale * 100)}%`;
    hint.hidden = viewport.scrollWidth <= viewport.clientWidth + 1 && viewport.scrollHeight <= viewport.clientHeight + 1;
  }
  function zoom(next) {
    mode = next <= fit + .001 ? "fit" : "manual";
    scale = Math.max(fit, Math.min(maximum, next));
    update();
  }
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(toolbar);
    observer.observe(container);
  } else window.addEventListener("resize", update);
  update();
}

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
        mountDiagramViewport(container, svg);
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
    url: new URL(siteBase + encodeURIComponent(article.slug) + "/" + window.location.hash, window.location.href).href
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

async function showArticle(article, htmlSlots) {
  document.documentElement.lang = article.language || "pt-BR";
  document.title = `${article.title} — Tech Topics`;
  document.querySelector("#article-description").content = article.excerpt;
  document.querySelector("#article-category").textContent = article.category;
  const heading = document.querySelector("#article-heading");
  heading.innerHTML = htmlSlots.heading;
  if (typeof article.headingAnchor === "string" && article.headingAnchor && !document.getElementById(article.headingAnchor)) {
    const anchor = document.createElement("span");
    anchor.id = article.headingAnchor;
    heading.before(anchor);
  }
  document.querySelector("#article-dek").innerHTML = htmlSlots.dek;
  const publishedAt = new Date(`${article.publishedAt}T00:00:00Z`);
  const date = Number.isNaN(publishedAt.getTime()) ? (article.date || "") : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "UTC" }).format(publishedAt);
  const details = [date];
  if (/\d/.test(article.read || "")) details.push(article.read);
  document.querySelector("#article-meta").textContent = details.filter(Boolean).join(" · ");
  const image = document.querySelector("#article-image");
  const originalCover = coverFor(article);
  const cover = { ...originalCover, src: siteBase + originalCover.src };
  image.src = cover.src;
  image.alt = cover.alt;
  document.querySelector(".article-hero").hidden = false;
  document.querySelector("#article-body").innerHTML = htmlSlots.body;
  // Compiled article references are relative to the site root, while fragments
  // remain local to the current document.
  for (const node of document.querySelectorAll("#article-body [href], #article-body [src], #article-body [srcset], #article-body [data-fallback-src]")) {
    const srcset = node.getAttribute("srcset");
    if (srcset) node.setAttribute("srcset", srcset.split(",").map(candidate => {
      const match = candidate.match(/^(\s*)(\S+)([\s\S]*)$/);
      return match && !/^(?:#|\/|[a-z][a-z0-9+.-]*:)/i.test(match[2])
        ? match[1] + siteBase + match[2] + match[3] : candidate;
    }).join(","));
    for (const name of ["href", "src", "data-fallback-src"]) {
      const value = node.getAttribute(name);
      if (value && !/^(?:#|\/|[a-z][a-z0-9+.-]*:)/i.test(value)) node.setAttribute(name, siteBase + value);
    }
  }
  // Initial deep links arrive before the asynchronously loaded body exists.
  // Find both generated IDs and the named anchors retained by older articles.
  if (window.location.hash) {
    try {
      const fragment = decodeURIComponent(window.location.hash.slice(1));
      const target = document.getElementById(fragment) || document.getElementsByName(fragment)[0];
      if (target) requestAnimationFrame(() => target.scrollIntoView());
    } catch (_) { /* An invalid fragment must not block article rendering. */ }
  }
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

async function loadCatalogHtml(slug, catalogArticle = null) {
  let article = catalogArticle;
  if (!article) {
    const catalogResponse = await fetch(siteBase + "assets/articles-catalog.json" + publicationQuery, { cache: "no-store" });
    if (!catalogResponse.ok) throw new Error("Catálogo indisponível");
    article = articleCatalogEntries(await catalogResponse.json()).find(item => item?.slug === slug);
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

  const htmlResponse = await fetch(siteBase + transport.path + publicationQuery, { cache: "no-store" });
  if (!htmlResponse.ok) throw new Error("Artigo HTML indisponível");
  const slots = articleHtmlSlots(await htmlResponse.text(), slug, transport);
  return { article, slots };
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
  return catalog.articles.map(article => {
    const slug = article?.slug;
    if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
      || slugs.has(slug) || article.format !== "html-v1"
      || article.path !== `content/articles/${slug}.html`
      || Object.hasOwn(article, "bodyHtml") || Object.hasOwn(article, "html")) {
      throw new Error("Registro HTML inválido no catálogo");
    }
    slugs.add(slug);
    return {
      ...article,
      transport: { format: article.format, path: article.path, buildId: catalog.buildId }
    };
  });
}

async function loadHtmlFromCatalog(requestedArticleSlug) {
  const catalogResponse = await fetch(siteBase + "assets/articles-catalog.json" + publicationQuery, { cache: "no-store" });
  if (!catalogResponse.ok) throw new Error("Catálogo indisponível");
  const catalog = articleCatalogEntries(await catalogResponse.json());
  const article = requestedArticleSlug
    ? catalog.find(item => item?.slug === requestedArticleSlug)
    : catalog[0];
  if (!article) throw new Error("Artigo ausente no catálogo");
  return { ...(await loadCatalogHtml(article.slug, article)), catalog };
}

async function loadArticle() {
  try {
    const { article, slots, catalog } = await loadHtmlFromCatalog(requestedSlug);
    await showArticle(article, slots);
    try {
      const suggestions = window.TechTopicsCards.recommendArticles(catalog, article);
      if (suggestions.length) {
        const cards = window.TechTopicsCards.createCards({
          quickActions: document.querySelector("#article-quick-actions"),
          shareStatus: document.querySelector("#share-status"), lazyImages: true
        });
        document.querySelector("#recommendations-list").replaceChildren(...suggestions.map((item, index) => cards.articleCard(item, index)));
        document.querySelector("#recommendations").hidden = false;
      }
    } catch (error) { /* Recommendations must not interrupt article reading. */ }
  } catch (error) {
    console.error("Tech Topics: não foi possível carregar o artigo", error);
    document.querySelector("#article-category").textContent = "Arquivo";
    document.querySelector("#article-heading").textContent = "Artigo indisponível";
    document.querySelector(".article-hero").hidden = true;
    document.querySelector("#article-actions").hidden = true;
    document.querySelector("#article-body").innerHTML = "<p>Não foi possível carregar este artigo. Volte ao arquivo e tente novamente.</p><p><a class=\"article-back\" href=\"" + siteBase + "index.html#recent-posts\">← Todos os artigos</a></p>";
  }
}

loadArticle();
