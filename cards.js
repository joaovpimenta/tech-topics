// Shared card and quick-action behavior for the archive and article pages.
(function (root) {
  function recommendArticles(records, current, random = Math.random) {
    if (!Array.isArray(records) || !current || typeof current.slug !== "string") return [];
    const tags = new Set(Array.isArray(current.tags) ? current.tags.filter(tag => typeof tag === "string" && tag) : []);
    const seen = new Set([current.slug]);
    const related = [], other = [];
    for (const article of records) {
      if (!article || typeof article.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug) || seen.has(article.slug)
        || ![article.title, article.category, article.excerpt, article.image].every(value => typeof value === "string" && value.trim())) continue;
      seen.add(article.slug);
      const matches = Array.isArray(article.tags) && article.tags.some(tag => typeof tag === "string" && tags.has(tag));
      (matches ? related : other).push(article);
    }
    function sample(pool, count) {
      const items = pool.slice();
      for (let i = 0; i < Math.min(count, items.length); i++) {
        const j = i + Math.floor(random() * (items.length - i));
        [items[i], items[j]] = [items[j], items[i]];
      }
      return items.slice(0, count);
    }
    const chosen = sample(related, 3);
    return chosen.concat(sample(other, 3 - chosen.length));
  }
  function createCards({ quickActions, shareStatus, lazyImages = false }) {
    const siteBase = root.TechTopicsSiteBase || "";
    const articleUrl = article => siteBase + encodeURIComponent(article.slug) + "/";
    const FAVORITES_KEY = "tech-topics:favorites:v1";
function readFavorites(fallback = []) {
  try {
    const values = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return new Set(Array.isArray(values) ? values.filter(value => typeof value === "string") : []);
  } catch (_) { return new Set(fallback); }
}
const favorites = readFavorites();
let favoritesPersisted = true;

function syncFavorites() {
  if (!favoritesPersisted) return;
  const stored = readFavorites(favorites);
  favorites.clear();
  stored.forEach(slug => favorites.add(slug));
}

function toggleFavorite(slug, button) {
  syncFavorites();
  if (favorites.has(slug)) favorites.delete(slug);
  else favorites.add(slug);
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites])); }
  catch (_) { favoritesPersisted = false; /* Keep the in-memory selection when persistence fails. */ }
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

// The quick-action menu is transient for hover and touch/mouse gestures.
// Keyboard access uses the same controls.
let gesture = null;
let quickMode = null;
let suppressedClickUntil = 0;
let quickHint = null;
let hoverOpenTimer = null;
let hoverCloseTimer = null;
let hoverCard = null;

function closeQuickActions() {
  clearTimeout(hoverOpenTimer);
  clearTimeout(hoverCloseTimer);
  hoverOpenTimer = null;
  hoverCloseTimer = null;
  hoverCard = null;
  if (quickActions) {
    quickActions.hidden = true;
    quickActions.replaceChildren();
    quickActions.style.height = "";
    quickActions.classList.toggle("quick-actions-below", false);
    quickActions.classList.toggle("quick-actions-compact", false);
    delete quickActions.dataset.activeAction;
    delete quickActions.dataset.gestureActive;
  }
  quickHint = null;
  quickMode = null;
  document.body.classList.remove("quick-gesture-active");
}

function scheduleHoverClose() {
  clearTimeout(hoverCloseTimer);
  hoverCloseTimer = setTimeout(() => {
    if (quickMode !== "hover" || hoverCard?.matches(":hover") || quickActions?.matches(":hover")) return;
    closeQuickActions();
  }, 180);
}

function quickActionHint(mode, action = "") {
  if (mode === "hover") return "Clique em uma ação; afaste o cursor para fechar.";
  if (mode === "keyboard") return "Use Tab para escolher uma ação, Enter para ativar e Escape para fechar.";
  if (action) return ({
    read: "Solte para ler o artigo.",
    favorite: "Solte para alternar favorito.",
    share: "Solte para compartilhar."
  })[action];
  return "Arraste até uma ação e solte. Solte fora para fechar.";
}

if (quickActions) {
  quickActions.addEventListener("pointerenter", event => {
    if (event.pointerType !== "mouse" || quickMode !== "hover") return;
    clearTimeout(hoverCloseTimer);
    hoverCloseTimer = null;
  });
  quickActions.addEventListener("pointerleave", event => {
    if (event.pointerType === "mouse" && quickMode === "hover") scheduleHoverClose();
  });
}

function quickActionAt(x, y, slop = 0) {
  if (!quickActions || quickActions.hidden) return null;
  // Touch events remain owned by the original card even when the finger
  // travels over the popup. Geometry, not event.target or CSS :hover, selects
  // the action. Resolve a nearest hit so enlarged halos cannot steal touches.
  let nearest = null;
  let distance = Infinity;
  let centerDistance = Infinity;
  for (const button of quickActions.querySelectorAll("[data-quick-action]")) {
    const rect = button.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    // The highlighted button scales up slightly. If its transformed hitbox
    // overlaps the next button's halo, prefer the target whose center is
    // closest instead of always preferring the first action in DOM order.
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    const squared = dx * dx + dy * dy;
    const centerSquared = (x - (rect.left + rect.right) / 2) ** 2 +
      (y - (rect.top + rect.bottom) / 2) ** 2;
    if (squared <= slop * slop &&
        (squared < distance || (squared === distance && centerSquared < centerDistance))) {
      nearest = button;
      distance = squared;
      centerDistance = centerSquared;
    }
  }
  return nearest;
}

function highlightQuickAction(x, y) {
  const hovered = quickActionAt(x, y, 8);
  const name = hovered?.dataset.quickAction || "";
  for (const button of quickActions.querySelectorAll("[data-quick-action]")) {
    button.classList.toggle("is-targeted", button === hovered);
  }
  if (quickHint && quickMode !== "gesture") quickHint.textContent = quickActionHint(quickMode);
  if (gesture?.active && gesture.highlightedAction !== name) {
    gesture.highlightedAction = name;
    quickActions.dataset.activeAction = name;
    if (quickHint) quickHint.textContent = quickActionHint("gesture", name);
    // Short haptic tick only when entering a *new* action, not on every move.
    // Web Vibration is unsupported on iOS and may be disabled by the device.
    if (name && gesture.kind === "touch" && typeof navigator.vibrate === "function") {
      try { navigator.vibrate(12); } catch (_) { /* Haptics are best effort. */ }
    }
  }
  return hovered;
}

function openQuickActions(article, favoriteButton, x, y, mode = "gesture", sourceCard = null) {
  if (!quickActions) return;
  syncFavorites();
  closeQuickActions();
  const cover = element("img", "quick-cover");
  cover.src = siteBase + article.image;
  cover.alt = article.alt || article.title;
  cover.loading = "lazy";
  cover.decoding = "async";
  cover.draggable = false;
  const title = element("h2", "quick-title", article.title);
  title.id = "quick-preview-title";
  const summary = element("div", "quick-description");
  const meta = element("p", "quick-meta", [article.category, article.read].filter(Boolean).join(" · "));
  // Prioritize the article's own opening allegory rather than duplicating the
  // card excerpt or the header dek. All text comes from the lightweight catalog.
  const opening = element("p", "quick-opening", article.opening || article.dek || article.excerpt || "");
  const hint = element("p", "quick-hint", quickActionHint(mode));
  quickHint = hint;
  summary.append(meta, opening, hint);
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
  if (mode === "hover") hoverCard = sourceCard;
  if (mode === "gesture") quickActions.dataset.gestureActive = "";
  else delete quickActions.dataset.gestureActive;

  // Keep the action row within a short drag from the original finger.
  // A 500px popup clamped to the top of a phone used to put the actions
  // *below* the finger even though the gesture asks users to drag upwards.
  const viewportW = window.innerWidth || document.documentElement.clientWidth;
  const viewportH = window.innerHeight || document.documentElement.clientHeight;
  const popupWidth = quickActions.getBoundingClientRect().width || 300;
  const popupHeight = quickActions.getBoundingClientRect().height || 0;
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
    : mode === "hover"
      ? (() => {
          const cardBounds = sourceCard?.getBoundingClientRect();
          const spaceAbove = cardBounds ? cardBounds.top - 24 : y - popupHeight - 12;
          const spaceBelow = cardBounds ? viewportH - cardBounds.bottom - 24 : viewportH - y - popupHeight - 24;
          if (spaceBelow >= popupHeight) return cardBounds.bottom + 12;
          if (spaceAbove >= popupHeight) return cardBounds.top - popupHeight - 12;
          return spaceBelow >= spaceAbove ? Math.max(12, viewportH - popupHeight - 12) : 12;
        })()
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
      if (quickMode === "keyboard" || quickMode === "hover") perform(button.dataset.quickAction);
    });
  }
  // Gesture actions are resolved on release, not via a synthetic click.
  quickActions.performAction = perform;
  if (mode === "keyboard") read.focus();
  else highlightQuickAction(x, y); // immediate visual feedback if opened under a button
}

function cancelGesture(nativeCancel = false) {
  if (gesture?.timer) clearTimeout(gesture.timer);
  if (gesture?.active) {
    if (nativeCancel && quickActions && !quickActions.hidden) {
      // Some mobile engines take ownership of a vertical pan after long-press
      // and emit touchcancel. Keep the preview tappable instead of discarding it.
      quickMode = "keyboard";
      delete quickActions.dataset.gestureActive;
      document.body.classList.remove("quick-gesture-active");
      for (const button of quickActions.querySelectorAll("[data-quick-action]")) {
        button.classList.remove("is-targeted");
      }
      quickActions.dataset.activeAction = "";
      if (quickHint) quickHint.textContent = "Toque em uma ação para continuar ou pressione Escape para fechar.";
    } else closeQuickActions();
  }
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
}, { capture: true, passive: false });
document.addEventListener("touchend", event => {
  if (gesture?.kind !== "touch") return;
  const touch = [...event.changedTouches].find(t => t.identifier === gesture.id);
  if (touch && endGesture(touch.clientX, touch.clientY)) event.preventDefault();
}, { capture: true, passive: false });
document.addEventListener("touchcancel", event => {
  if (gesture?.kind === "touch" && [...event.changedTouches].some(t => t.identifier === gesture.id)) cancelGesture(true);
}, { capture: true });
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
  if (event.key === "Escape" && quickMode) closeQuickActions();
});
document.addEventListener("scroll", () => {
  if (quickMode === "hover") closeQuickActions();
}, { capture: true, passive: true });
document.addEventListener("pointerdown", event => {
  if (quickMode === "keyboard" && !quickActions.contains(event.target)) closeQuickActions();
});

function articleCard(article, index) {
  syncFavorites();
  const card = element("article", "recent-item");
  card.tabIndex = 0;
  card.setAttribute("aria-label", "Ações rápidas para " + article.title + ": passe o cursor, segure ou pressione Enter");
  const imageLink = element("a", "recent-image image-link");
  imageLink.href = articleUrl(article);
  imageLink.setAttribute("aria-label", "Ler " + article.title);
  const image = element("img");
  image.src = siteBase + article.image;
  image.alt = article.alt || article.title;
  image.loading = lazyImages || index >= 2 ? "lazy" : "eager";
  image.decoding = "async";
  image.draggable = false;
  imageLink.draggable = false;
  if (!lazyImages && index === 0) image.fetchPriority = "high";
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
  card.addEventListener("pointerenter", event => {
    if (event.pointerType !== "mouse" || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    clearTimeout(hoverCloseTimer);
    clearTimeout(hoverOpenTimer);
    hoverOpenTimer = setTimeout(() => {
      if (!card.matches(":hover")) return;
      const bounds = card.getBoundingClientRect();
      openQuickActions(article, like, bounds.left + bounds.width / 2, bounds.bottom, "hover", card);
    }, 140);
  });
  card.addEventListener("pointerleave", event => {
    if (event.pointerType !== "mouse") return;
    clearTimeout(hoverOpenTimer);
    hoverOpenTimer = null;
    if (hoverCard === card && quickMode === "hover") scheduleHoverClose();
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


    return { articleCard, favorites };
  }
  const api = { createCards, recommendArticles };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TechTopicsCards = api;
})(typeof window !== "undefined" ? window : globalThis);
