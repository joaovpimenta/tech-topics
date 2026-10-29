(() => {
  "use strict";
  const input = document.querySelector("#search-input, #article-search-input");
  const panel = document.querySelector("#search-suggestions");
  if (!input || !panel) return;

  const container = input.closest(".top-search");
  const MAX_SUGGESTIONS = 5;
  const normalize = value => String(value || "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const siteBase = window.TechTopicsSiteBase || "./";
  let articles = [];
  let opened = false;

  function match(query) {
    const terms = normalize(query.trim()).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return articles.map((article, index) => {
      const title = normalize(article.title);
      const tags = normalize([...(article.tags || []), ...(article.tagLabels || [])].join(" "));
      const category = normalize(article.category);
      const description = normalize([article.excerpt, article.dek, article.opening].join(" "));
      const extras = normalize([article.level, article.series, ...(article.prerequisites || [])].join(" "));
      const searchable = [title, tags, category, description, extras].join(" ");
      if (!terms.every(term => searchable.includes(term))) return null;
      const whole = terms.join(" ");
      const rank = title.startsWith(whole) ? 0
        : title.includes(whole) ? 1
          : tags.includes(whole) ? 2
            : category.includes(whole) ? 3
              : description.includes(whole) ? 4 : 5;
      return { article, index, rank };
    }).filter(Boolean).sort((a, b) => a.rank - b.rank || a.index - b.index);
  }

  function articleUrl(article) {
    return new URL(siteBase + encodeURIComponent(article.slug) + "/", document.baseURI).href;
  }

  function dismiss() {
    opened = false;
    panel.hidden = true;
    input.setAttribute("aria-expanded", "false");
  }

  function place() {
    const rect = container.getBoundingClientRect();
    const viewport = window.visualViewport;
    const width = Math.min(500, Math.max(200, (viewport?.width || window.innerWidth) - 24));
    const visibleWidth = viewport?.width || window.innerWidth;
    const x = Math.max(12, Math.min(rect.left, visibleWidth - width - 12));
    const top = rect.bottom + 8;
    panel.style.width = width + "px";
    panel.style.left = x + "px";
    panel.style.top = top + "px";
    panel.style.maxHeight = Math.max(100, (viewport?.height || window.innerHeight) - top - 16) + "px";
  }

  function render() {
    const query = input.value.trim();
    panel.replaceChildren();
    if (!opened || !query || !articles.length) {
      panel.hidden = true;
      input.setAttribute("aria-expanded", "false");
      return;
    }

    const results = match(query);
    const heading = document.createElement("p");
    heading.className = "search-suggestions-heading";
    heading.textContent = results.length
      ? "Artigos encontrados" : "Nenhum artigo encontrado";
    panel.append(heading);

    if (results.length) {
      const list = document.createElement("ul");
      list.className = "search-suggestions-list";
      for (const { article } of results.slice(0, MAX_SUGGESTIONS)) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = articleUrl(article);
        link.className = "search-suggestion-link";
        const title = document.createElement("strong");
        title.className = "search-suggestion-title";
        title.textContent = article.title;
        const category = document.createElement("span");
        category.className = "search-suggestion-category";
        category.textContent = article.category;
        link.append(title, category);
        item.append(link);
        list.append(item);
      }
      panel.append(list);

      const more = document.createElement("a");
      more.className = "search-suggestions-more";
      more.href = new URL(siteBase + "index.html?q=" + encodeURIComponent(query), document.baseURI).href;
      more.textContent = "Ver todos os " + results.length + " resultado" + (results.length === 1 ? "" : "s");
      panel.append(more);
    }

    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
    place();
  }

  input.setAttribute("aria-controls", panel.id);
  input.setAttribute("aria-expanded", "false");
  input.addEventListener("focus", () => { opened = true; render(); });
  input.addEventListener("input", () => { opened = true; render(); });
  input.addEventListener("keydown", event => {
    if (event.key === "Escape") { dismiss(); return; }
    if (event.key === "ArrowDown" && !panel.hidden) {
      const first = panel.querySelector("a");
      if (first) { event.preventDefault(); first.focus(); }
    }
  });
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      input.focus();
      dismiss();
      return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const links = [...panel.querySelectorAll("a")];
    const index = links.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    if (event.key === "ArrowDown") links[(index + 1) % links.length].focus();
    else if (index === 0) input.focus();
    else links[index - 1].focus();
  });
  container.addEventListener("focusout", () => {
    setTimeout(() => { if (!container.contains(document.activeElement)) dismiss(); }, 0);
  });
  document.addEventListener("pointerdown", event => {
    if (!container.contains(event.target)) dismiss();
  });
  window.addEventListener("resize", () => { if (!panel.hidden) place(); });
  window.addEventListener("scroll", () => { if (!panel.hidden) place(); }, { passive: true });
  window.visualViewport?.addEventListener("resize", () => { if (!panel.hidden) place(); });

  window.TechTopicsSearch = {
    setArticles(records) {
      articles = Array.isArray(records) ? records.filter(article =>
        article && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug) &&
        typeof article.title === "string" && typeof article.category === "string") : [];
      render();
    }
  };
})();
