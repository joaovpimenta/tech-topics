const articles = [];
const list = document.querySelector("#recent-list");
const searchInput = document.querySelector("#search-input");
const count = document.querySelector("#article-count");
const status = document.querySelector("#archive-status");
const emptyState = document.querySelector("#empty-state");
const loadMore = document.querySelector("#load-more");
const quickActions = document.querySelector("#article-quick-actions");
const shareStatus = document.querySelector("#share-status");
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
  if (button) {
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

// The quick-action menu is transient for touch/mouse gestures: it stays visible
// only while the original press is held. Keyboard access uses the same controls.
let gesture = null;
let quickMode = null;
let suppressedClickUntil = 0;
let quickHint = null;

function closeQuickActions() {
  if (quickActions) {
    quickActions.hidden = true;
    quickActions.replaceChildren();
    quickActions.style.height = "";
    quickActions.classList.toggle("quick-actions-below", false);
    quickActions.classList.toggle("quick-actions-compact", false);
    delete quickActions.dataset.activeAction;
  }
  quickHint = null;
  quickMode = null;
  document.body.classList.remove("quick-gesture-active");
}

function quickActionAt(x, y, slop = 0) {
  if (!quickActions || quickActions.hidden) return null;
  // The original card owns the touch stream, so event.target is not the
  // popup button. Hit-test by viewport coordinates, including SVG children.
  const target = document.elementFromPoint?.(x, y);
  const button = target?.closest?.("[data-quick-action]");
  if (button && quickActions.contains(button)) return button;
  // A small tolerance makes selection stable at action edges while moving.
  // Releases use exact hit-testing to keep "soltar fora" a safe cancellation.
  for (const candidate of quickActions.querySelectorAll("[data-quick-action]")) {
    const rect = candidate.getBoundingClientRect();
    if (x >= rect.left - slop && x <= rect.right + slop &&
        y >= rect.top - slop && y <= rect.bottom + slop) return candidate;
  }
  return null;
}

function highlightQuickAction(x, y) {
  const hovered = quickActionAt(x, y, 8);
  const name = hovered?.dataset.quickAction || "";
  for (const button of quickActions.querySelectorAll("[data-quick-action]")) {
    button.classList.toggle("is-targeted", button === hovered);
  }
  if (gesture?.active && gesture.highlightedAction !== name) {
    gesture.highlightedAction = name;
    quickActions.dataset.activeAction = name;
    if (quickHint) quickHint.textContent = name
      ? ({ read: "Solte para ler o artigo.", favorite: "Solte para alternar favorito.",
           share: "Solte para compartilhar." })[name]
      : "Arraste até uma ação e solte. Solte fora para fechar.";
    // Short haptic tick only when entering a *new* action, not on every move.
    // Web Vibration is unsupported on iOS and may be disabled by the device.
    if (name && gesture.kind === "touch" && typeof navigator.vibrate === "function") {
      try { navigator.vibrate(12); } catch (_) { /* Haptics are best effort. */ }
    }
  }
  return hovered;
}

function openQuickActions(article, favoriteButton, x, y, mode = "gesture") {
  if (!quickActions) return;
  closeQuickActions();
  const cover = element("img", "quick-cover");
  cover.src = article.image;
  cover.alt = article.alt || article.title;
  cover.loading = "lazy";
  cover.decoding = "async";
  cover.draggable = false;
  const title = element("h2", "quick-title", article.title);
  title.id = "quick-preview-title";
  const summary = element("div", "quick-description");
  const meta = element("p", "quick-meta", [article.category, article.read].filter(Boolean).join(" · "));
  const dek = element("p", "quick-summary", article.dek || article.excerpt || "");
  const excerpt = article.dek && article.excerpt && article.excerpt !== article.dek
    ? element("p", "quick-excerpt", article.excerpt) : null;
  const hint = element("p", "quick-hint", "Arraste até uma ação e solte. Solte fora para fechar.");
  quickHint = hint;
  summary.append(...[meta, dek, excerpt, hint].filter(Boolean));
  const controls = element("div", "quick-controls");

  const read = element("button", "quick-read", "Ler artigo");
  read.type = "button";
  read.dataset.quickAction = "read";
  read.setAttribute("aria-label", "Ler " + article.title);

  const like = element("button", "card-icon-button favorite-button quick-icon");
  like.type = "button";
  like.dataset.quickAction = "favorite";
  const selected = favorites.has(article.slug);
  like.setAttribute("aria-label", (selected ? "Remover dos favoritos: " : "Adicionar aos favoritos: ") + article.title);
  like.setAttribute("aria-pressed", String(selected));
  if (selected) like.classList.add("is-favorite");
  like.append(icon("heart"));

  const share = element("button", "card-icon-button quick-icon");
  share.type = "button";
  share.dataset.quickAction = "share";
  share.setAttribute("aria-label", "Compartilhar " + article.title);
  share.append(icon("share"));
  controls.append(read, like, share);
  quickActions.replaceChildren(cover, title, summary, controls);
  quickActions.hidden = false;
  quickMode = mode;

  // Keep the action row within a short drag from the original finger.
  // A 500px popup clamped to the top of a phone used to put the actions
  // *below* the finger even though the gesture asks users to drag upwards.
  const viewportW = window.innerWidth || document.documentElement.clientWidth;
  const viewportH = window.innerHeight || document.documentElement.clientHeight;
  const popupWidth = quickActions.getBoundingClientRect().width || 300;
  const left = Math.min(Math.max(10, x - popupWidth / 2), Math.max(10, viewportW - popupWidth - 10));
  const maxHeight = Math.min(500, viewportH - 24);
  const below = mode === "gesture" && y < 260;
  const height = mode === "gesture"
    ? Math.max(120, Math.min(maxHeight, below ? viewportH - y - 24 : y - 12))
    : maxHeight;
  if (mode === "gesture") quickActions.style.height = height + "px";
  quickActions.classList.toggle("quick-actions-below", below);
  quickActions.classList.toggle("quick-actions-compact", mode === "gesture" && !below && height < 355);
  const top = below ? y + 12 : mode === "gesture"
    ? Math.min(Math.max(12, y - height + 12), Math.max(12, viewportH - height - 12))
    : Math.min(Math.max(12, y - height + 48), Math.max(12, viewportH - height - 12));
  if (below) hint.textContent = "Arraste para baixo até uma ação e solte. Solte fora para fechar.";
  quickActions.style.left = left + "px";
  quickActions.style.top = top + "px";
  document.body.classList.toggle("quick-gesture-active", mode === "gesture");

  const perform = name => {
    closeQuickActions();
    if (name === "read") window.location.assign(articleUrl(article));
    else if (name === "favorite") toggleFavorite(article.slug, favoriteButton);
    else if (name === "share") shareArticle(article);
  };
  for (const button of controls.children) {
    button.addEventListener("click", () => {
      if (quickMode === "keyboard") perform(button.dataset.quickAction);
    });
  }
  // Gesture actions are resolved on release, not via a synthetic click.
  quickActions.performAction = perform;
  if (mode === "keyboard") read.focus();
}

function cancelGesture() {
  if (gesture?.timer) clearTimeout(gesture.timer);
  if (gesture?.active) closeQuickActions();
  gesture = null;
}

function armGesture(article, favoriteButton, x, y, kind, id) {
  cancelGesture();
  gesture = { article, favoriteButton, x, y, kind, id, active: false, highlightedAction: "" };
  const current = gesture;
  current.timer = setTimeout(() => {
    if (gesture !== current) return;
    current.timer = null;
    current.active = true;
    openQuickActions(article, favoriteButton, x, y);
  }, 480);
}

function moveGesture(x, y) {
  if (!gesture) return;
  if (!gesture.active) {
    if (Math.hypot(x - gesture.x, y - gesture.y) > 12) cancelGesture();
    return;
  }
  highlightQuickAction(x, y);
}

function endGesture(x, y) {
  if (!gesture) return false;
  if (!gesture.active) {
    cancelGesture();
    return false;
  }
  // Closing without a highlighted/targeted button must never activate one.
  const action = quickActionAt(x, y)?.dataset.quickAction;
  const perform = quickActions.performAction;
  gesture = null;
  closeQuickActions();
  suppressedClickUntil = Date.now() + 350;
  if (action) perform(action);
  return true;
}

// Touch events persist across drag even when browsers cancel pointer events
// to handle scrolling. Prior to the hold threshold, ordinary page scrolling wins.
document.addEventListener("touchmove", event => {
  if (gesture?.kind !== "touch") return;
  const touch = [...event.changedTouches].find(t => t.identifier === gesture.id);
  if (!touch) return;
  if (gesture.active) event.preventDefault();
  moveGesture(touch.clientX, touch.clientY);
}, { passive: false });
document.addEventListener("touchend", event => {
  if (gesture?.kind !== "touch") return;
  const touch = [...event.changedTouches].find(t => t.identifier === gesture.id);
  if (touch && endGesture(touch.clientX, touch.clientY)) event.preventDefault();
}, { passive: false });
document.addEventListener("touchcancel", event => {
  if (gesture?.kind === "touch" && [...event.changedTouches].some(t => t.identifier === gesture.id)) cancelGesture();
});
document.addEventListener("pointermove", event => {
  if (gesture?.kind === "pointer" && gesture.id === event.pointerId) moveGesture(event.clientX, event.clientY);
});
document.addEventListener("pointerup", event => {
  if (gesture?.kind !== "pointer" || gesture.id !== event.pointerId) return;
  if (endGesture(event.clientX, event.clientY)) event.preventDefault();
});
document.addEventListener("pointercancel", event => {
  if (gesture?.kind === "pointer" && gesture.id === event.pointerId) cancelGesture();
});
document.addEventListener("click", event => {
  if (Date.now() < suppressedClickUntil && event.detail !== 0) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && quickMode === "keyboard") closeQuickActions();
});
document.addEventListener("pointerdown", event => {
  if (quickMode === "keyboard" && !quickActions.contains(event.target)) closeQuickActions();
});

function articleCard(article, index) {
  const card = element("article", "recent-item");
  card.tabIndex = 0;
  card.setAttribute("aria-label", "Ações rápidas para " + article.title + ": segure ou pressione Enter");
  const imageLink = element("a", "recent-image image-link");
  imageLink.href = articleUrl(article);
  imageLink.setAttribute("aria-label", "Ler " + article.title);
  const image = element("img");
  image.src = article.image;
  image.alt = article.alt || article.title;
  image.loading = index < 2 ? "eager" : "lazy";
  image.decoding = "async";
  image.draggable = false;
  imageLink.draggable = false;
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
  // Disable native image/link dragging and the browser's long-press menu.
  // The card's custom hold-to-preview interaction must own this gesture.
  card.addEventListener("dragstart", event => event.preventDefault());
  card.addEventListener("selectstart", event => event.preventDefault());

  card.addEventListener("touchstart", event => {
    if (event.touches.length !== 1 || event.target.closest("button")) return;
    const touch = event.changedTouches[0];
    armGesture(article, like, touch.clientX, touch.clientY, "touch", touch.identifier);
  }, { passive: true });
  card.addEventListener("pointerdown", event => {
    if (event.pointerType === "touch" || event.button !== 0 || event.target.closest("button")) return;
    armGesture(article, like, event.clientX, event.clientY, "pointer", event.pointerId);
  });
  card.addEventListener("contextmenu", event => {
    if (!event.target.closest("button")) event.preventDefault();
  });
  card.addEventListener("keydown", event => {
    if (event.target !== card || (event.key !== " " && event.key !== "Enter")) return;
    event.preventDefault();
    const bounds = card.getBoundingClientRect();
    openQuickActions(article, like, bounds.left + bounds.width / 2,
      Math.min(bounds.bottom - 25, window.innerHeight - 45), "keyboard");
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
    normalize([article.title, article.category, article.excerpt, article.dek].join(" ")).includes(query)
  );
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
