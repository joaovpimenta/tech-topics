/* One data-only card tree feeds both build-time HTML and browser hydration. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TechTopicsHomeCards = api;
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  const el = (tag, attrs = {}, children = []) => ({ tag, attrs, children });
  const txt = value => ({ text: String(value ?? "") });
  function dateLabel(article) {
    const date = new Date(String(article.publishedAt || "") + "T00:00:00Z");
    return Number.isNaN(date.getTime()) ? String(article.date || "") :
      new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "UTC" }).format(date);
  }
  function icon(kind) {
    const d = kind === "heart"
      ? "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"
      : "M12 16V3m0 0L7 8m5-5 5 5M5 13v5a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-5";
    return el("svg", { viewBox: "0 0 24 24", width: "19", height: "19", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }, [el("path", { d })]);
  }
  function tree(article, index, favorite = false) {
    if (!article || typeof article.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug)) throw new Error("Invalid article slug for home card");
    if (typeof article.image !== "string" || !article.image || article.image.startsWith("/") ||
        /^[a-z][a-z\d+.-]*:/i.test(article.image) || /[?#\u0000-\u001f]/.test(article.image) ||
        article.image.includes("\\") || article.image.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Invalid relative image URL for home card");
    const url = "article.html?slug=" + encodeURIComponent(article.slug);
    const title = String(article.title ?? "");
    const selected = Boolean(favorite);
    const label = (selected ? "Remover dos favoritos: " : "Adicionar aos favoritos: ") + title;
    const meta = [dateLabel(article), article.read].filter(Boolean).join(" · ");
    return el("article", { class: "recent-item", "data-article-slug": article.slug, tabindex: "0", "aria-label": `Ações rápidas para ${title}: segure ou pressione Enter` }, [
      el("a", { class: "recent-image image-link", href: url, "aria-label": `Ler ${title}`, draggable: "false" }, [
        el("img", { src: article.image, alt: article.alt || title, loading: index < 2 ? "eager" : "lazy", decoding: "async", draggable: "false", ...(index === 0 ? { fetchpriority: "high" } : {}) })
      ]),
      el("div", { class: "recent-copy" }, [
        el("p", { class: "eyebrow" }, [txt(article.category)]),
        el("h3", {}, [el("a", { href: url }, [txt(title)])]),
        el("p", { class: "excerpt" }, [txt(article.excerpt || article.dek || "")]),
        el("p", { class: "post-meta" }, [txt(meta)])
      ]),
      el("div", { class: "card-actions" }, [
        el("button", { class: `card-icon-button favorite-button${selected ? " is-favorite" : ""}`, type: "button", "data-article-title": title, "aria-label": label, "aria-pressed": String(selected), title: selected ? "Remover dos favoritos" : "Adicionar aos favoritos" }, [icon("heart")]),
        el("button", { class: "card-icon-button", type: "button", "aria-label": `Compartilhar ${title}`, title: "Compartilhar" }, [icon("share")])
      ])
    ]);
  }
  function renderNode(doc, descriptor, namespace = null) {
    if (Object.hasOwn(descriptor, "text")) return doc.createTextNode(descriptor.text);
    const nodeNamespace = namespace || (descriptor.tag === "svg" ? "http://www.w3.org/2000/svg" : null);
    const node = nodeNamespace ? doc.createElementNS(nodeNamespace, descriptor.tag) : doc.createElement(descriptor.tag);
    for (const [name, value] of Object.entries(descriptor.attrs)) node.setAttribute(name, String(value));
    for (const child of descriptor.children) node.append(renderNode(doc, child, nodeNamespace));
    return node;
  }
  function serialize(descriptor) {
    if (Object.hasOwn(descriptor, "text")) return escapeHtml(descriptor.text);
    const attrs = Object.entries(descriptor.attrs).map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join("");
    const voidTag = ["img"].includes(descriptor.tag);
    return `<${descriptor.tag}${attrs}>${voidTag ? "" : descriptor.children.map(serialize).join("") + `</${descriptor.tag}>`}`;
  }
  function renderIntoHome(html, catalog, limit = 6) {
    const start = "<!-- HOME_CARDS_START -->";
    const end = "<!-- HOME_CARDS_END -->";
    const marker = /<!-- HOME_CARDS_START -->[\s\S]*?<!-- HOME_CARDS_END -->/;
    if (html.split(start).length !== 2 || html.split(end).length !== 2 || !marker.test(html)) {
      throw new Error("index.html must contain one ordered pair of home cards build markers");
    }
    const rendered = catalog.slice(0, limit).map((article, index) => serialize(tree(article, index))).join("\n          ");
    const replacement = `<!-- HOME_CARDS_START -->\n          ${rendered}\n          <!-- HOME_CARDS_END -->`;
    return html.replace(marker, () => replacement);
  }
  return Object.freeze({ render: (article, index, favorite = false) => serialize(tree(article, index, favorite)), create: (doc, article, index, favorite = false) => renderNode(doc, tree(article, index, favorite)), renderIntoHome });
});
