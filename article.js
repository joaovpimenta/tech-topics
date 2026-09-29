const params = new URLSearchParams(window.location.search);
const requestedSlug = params.get("slug");

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
const speechButton = document.querySelector("#listen-article");
const speechStopButton = document.querySelector("#stop-listening");
const speechStatus = document.querySelector("#listen-status");
const shareButton = document.querySelector("#share-article");
const shareStatus = document.querySelector("#share-status");
const speechSupported = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

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

let speechQueue = [];
let speechIndex = 0;
let speechState = "idle";
let speechSession = 0;
let shareData = null;

function preferredVoice(language) {
  const voices = window.speechSynthesis.getVoices();
  const normalizedLanguage = language.toLowerCase();
  const languagePrefix = normalizedLanguage.split("-")[0];
  return voices.find(voice => voice.lang.toLowerCase() === normalizedLanguage)
    || voices.find(voice => voice.lang.toLowerCase() === languagePrefix)
    || voices.find(voice => voice.lang.toLowerCase().startsWith(`${languagePrefix}-`))
    || null;
}

function splitSpeechText(text, language, maxLength = 240) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?;:]+[.!?;:]?|.+$/g) || [clean];
  const chunks = [];

  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    if (part.length <= maxLength) {
      chunks.push({ text: part, lang: language });
      continue;
    }

    let current = "";
    for (const word of part.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxLength && current) {
        chunks.push({ text: current, lang: language });
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) chunks.push({ text: current, lang: language });
  }

  return chunks;
}

function articleSpeechSegments(node, defaultLanguage = "pt-BR") {
  const segments = [];
  const appendText = (text, language) => {
    if (!text) return;
    const previous = segments.at(-1);
    if (previous?.lang === language) previous.text += text;
    else segments.push({ text, lang: language });
  };

  const visit = (currentNode, inheritedLanguage) => {
    if (currentNode.nodeType === Node.TEXT_NODE) {
      appendText(currentNode.nodeValue, inheritedLanguage);
      return;
    }
    if (currentNode.nodeType !== Node.ELEMENT_NODE) return;

    const language = currentNode.getAttribute("lang")?.trim() || inheritedLanguage;
    currentNode.childNodes.forEach(child => visit(child, language));
  };

  const language = node.closest("[lang]")?.getAttribute("lang") || defaultLanguage;
  visit(node, language);

  const normalizedSegments = [];
  segments.forEach(segment => {
    let text = segment.text.replace(/\s+/g, " ").trim();
    if (!text) return;

    const punctuation = text.match(/^\p{P}+/u)?.[0];
    const previous = normalizedSegments.at(-1);
    if (punctuation && previous) {
      previous.text += punctuation;
      text = text.slice(punctuation.length).trimStart();
    }
    if (!text) return;

    if (previous?.lang === segment.lang) previous.text = `${previous.text} ${text}`;
    else normalizedSegments.push({ text, lang: segment.lang });
  });

  return normalizedSegments.flatMap(segment => splitSpeechText(segment.text, segment.lang));
}

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
    if (segment.lang === defaultLanguage) {
      element.append(document.createTextNode(segment.text));
      return;
    }

    const span = document.createElement("span");
    span.lang = segment.lang;
    span.textContent = segment.text;
    element.append(span);
  });
}

function articleSpeechQueue() {
  const defaultLanguage = document.documentElement.lang || "pt-BR";
  const parts = [
    document.querySelector("#article-heading"),
    document.querySelector("#article-dek")
  ].filter(Boolean).flatMap(node => articleSpeechSegments(node, defaultLanguage));

  document.querySelectorAll("#article-body h2, #article-body h3, #article-body p, #article-body li, #article-body figcaption, #article-body th, #article-body td, #article-body .article-callout")
    .forEach(node => {
      if (node.closest("pre, code, .fgs-toc, .fgs-simulator")) return;
      if (node.matches(".article-callout") && node.querySelector("p")) return;
      parts.push(...articleSpeechSegments(node, defaultLanguage));
    });

  return parts;
}

function updateSpeechControls(message = "") {
  if (!articleActions) return;

  articleActions.hidden = false;
  speechStopButton.hidden = speechState === "idle";

  if (!speechSupported) {
    speechButton.hidden = true;
    speechStopButton.hidden = true;
    speechStatus.textContent = "Leitura em voz alta não é compatível com este navegador.";
    return;
  }

  speechButton.hidden = false;

  if (speechState === "speaking") {
    speechButton.textContent = "Pausar";
    speechButton.setAttribute("aria-pressed", "true");
    speechButton.setAttribute("aria-label", "Pausar leitura do artigo");
  } else if (speechState === "paused") {
    speechButton.textContent = "Continuar";
    speechButton.setAttribute("aria-pressed", "true");
    speechButton.setAttribute("aria-label", "Continuar leitura do artigo");
  } else {
    speechButton.textContent = "Ouvir artigo";
    speechButton.setAttribute("aria-pressed", "false");
    speechButton.setAttribute("aria-label", "Ouvir artigo");
  }

  speechStatus.textContent = message;
}

function finishSpeech(message = "Leitura concluída.") {
  speechQueue = [];
  speechIndex = 0;
  speechState = "idle";
  updateSpeechControls(message);
}

function stopSpeech(message = "") {
  speechSession += 1;
  window.speechSynthesis.cancel();
  finishSpeech(message);
}

function speakNext(session) {
  if (session !== speechSession || speechState === "idle") return;
  if (speechIndex >= speechQueue.length) {
    finishSpeech();
    return;
  }

  const segment = speechQueue[speechIndex];
  const utterance = new SpeechSynthesisUtterance(segment.text);
  utterance.lang = segment.lang;
  utterance.rate = 1;
  utterance.pitch = 1;
  const voice = preferredVoice(segment.lang);
  if (voice) utterance.voice = voice;

  utterance.onend = () => {
    if (session !== speechSession) return;
    speechIndex += 1;
    speakNext(session);
  };

  utterance.onerror = event => {
    if (session !== speechSession || event.error === "canceled" || event.error === "interrupted") return;
    speechSession += 1;
    window.speechSynthesis.cancel();
    finishSpeech("Não foi possível continuar a leitura neste navegador.");
  };

  window.speechSynthesis.speak(utterance);
}

function startSpeech() {
  speechQueue = articleSpeechQueue();
  if (!speechQueue.length) {
    updateSpeechControls("Não há texto disponível para leitura.");
    return;
  }

  window.speechSynthesis.cancel();
  speechSession += 1;
  speechIndex = 0;
  speechState = "speaking";
  updateSpeechControls("Lendo o artigo em voz alta.");
  speakNext(speechSession);
}

function setupSpeechControls() {
  updateSpeechControls();
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

speechButton?.addEventListener("click", () => {
  if (!speechSupported) return;

  if (speechState === "speaking") {
    window.speechSynthesis.pause();
    speechState = "paused";
    updateSpeechControls("Leitura pausada.");
    return;
  }

  if (speechState === "paused") {
    window.speechSynthesis.resume();
    speechState = "speaking";
    updateSpeechControls("Lendo o artigo em voz alta.");
    return;
  }

  startSpeech();
});

speechStopButton?.addEventListener("click", () => stopSpeech("Leitura interrompida."));

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

window.addEventListener("pagehide", () => {
  if (speechSupported) stopSpeech();
});

async function showArticle(article) {
  document.documentElement.lang = article.language || "pt-BR";
  document.title = `${article.title} — Tech Topics`;
  document.querySelector("#article-description").content = article.excerpt;
  document.querySelector("#article-category").textContent = article.category;
  renderSpeechMarkup(document.querySelector("#article-heading"), article.title, article.speechMarkup?.title, document.documentElement.lang);
  renderSpeechMarkup(document.querySelector("#article-dek"), article.dek || article.excerpt, article.speechMarkup?.dek, document.documentElement.lang);
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
  document.querySelector("#article-body").innerHTML = article.bodyHtml;
  await renderMermaidDiagrams();
  setupSpeechControls();
  setupShareControls(article);
  document.dispatchEvent(new Event("tech-topics:article-ready"));
}

async function loadArticle() {
  try {
    const manifestResponse = await fetch("content/articles/index.json", { cache: "no-store" });
    if (!manifestResponse.ok) throw new Error("Manifesto indisponível");
    const manifest = await manifestResponse.json();
    const entry = requestedSlug ? manifest.find(item => item.slug === requestedSlug) : manifest[0];
    if (!entry) throw new Error("Artigo não encontrado");
    const articleResponse = await fetch(entry.path, { cache: "no-store" });
    if (!articleResponse.ok) throw new Error("Artigo indisponível");
    await showArticle(await articleResponse.json());
  } catch (error) {
    document.querySelector("#article-category").textContent = "Arquivo";
    document.querySelector("#article-heading").textContent = "Artigo indisponível";
    document.querySelector(".article-hero").hidden = true;
    document.querySelector("#article-actions").hidden = true;
    document.querySelector("#article-body").innerHTML = "<p>Não foi possível carregar este artigo. Volte ao arquivo e tente novamente.</p><p><a class=\"article-back\" href=\"index.html#recent-posts\">← Todos os artigos</a></p>";
  }
}

loadArticle();
