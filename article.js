const params = new URLSearchParams(window.location.search);
const requestedSlug = params.get("slug");

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

const articleActions = document.querySelector("#article-actions");
const speechButton = document.querySelector("#listen-article");
const speechStopButton = document.querySelector("#stop-listening");
const speechStatus = document.querySelector("#listen-status");
const shareButton = document.querySelector("#share-article");
const shareStatus = document.querySelector("#share-status");
const speechSupported = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

let speechQueue = [];
let speechIndex = 0;
let speechState = "idle";
let speechSession = 0;
let shareData = null;

function preferredPortugueseVoice() {
  const voices = window.speechSynthesis.getVoices();
  return voices.find(voice => voice.lang.toLowerCase() === "pt-br")
    || voices.find(voice => voice.lang.toLowerCase().startsWith("pt-br"))
    || voices.find(voice => voice.lang.toLowerCase().startsWith("pt"))
    || null;
}

function splitSpeechText(text, maxLength = 240) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?;:]+[.!?;:]?|.+$/g) || [clean];
  const chunks = [];

  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    if (part.length <= maxLength) {
      chunks.push(part);
      continue;
    }

    let current = "";
    for (const word of part.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxLength && current) {
        chunks.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) chunks.push(current);
  }

  return chunks;
}

function articleSpeechQueue() {
  const parts = [
    document.querySelector("#article-heading")?.textContent,
    document.querySelector("#article-dek")?.textContent
  ].filter(Boolean);

  document.querySelectorAll("#article-body h2, #article-body h3, #article-body p, #article-body li, #article-body figcaption, #article-body th, #article-body td, #article-body .article-callout")
    .forEach(node => {
      if (node.closest("pre, code, .fgs-toc, .fgs-simulator")) return;
      if (node.matches(".article-callout") && node.querySelector("p")) return;
      const text = node.textContent.replace(/\s+/g, " ").trim();
      if (text) parts.push(text);
    });

  return parts.flatMap(part => splitSpeechText(part));
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
    speechButton.setAttribute("aria-label", "Ouvir artigo em português brasileiro");
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

  const utterance = new SpeechSynthesisUtterance(speechQueue[speechIndex]);
  utterance.lang = "pt-BR";
  utterance.rate = 1;
  utterance.pitch = 1;
  const voice = preferredPortugueseVoice();
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
  updateSpeechControls("Lendo em voz alta em português do Brasil.");
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
    updateSpeechControls("Lendo em voz alta em português do Brasil.");
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

function showArticle(article) {
  document.documentElement.lang = article.language || "pt-BR";
  document.title = `${article.title} — Tech Topics`;
  document.querySelector("#article-description").content = article.excerpt;
  document.querySelector("#article-category").textContent = article.category;
  document.querySelector("#article-heading").textContent = article.title;
  document.querySelector("#article-dek").textContent = article.dek || article.excerpt;
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
    showArticle(await articleResponse.json());
  } catch (error) {
    document.querySelector("#article-category").textContent = "Arquivo";
    document.querySelector("#article-heading").textContent = "Artigo indisponível";
    document.querySelector(".article-hero").hidden = true;
    document.querySelector("#article-actions").hidden = true;
    document.querySelector("#article-body").innerHTML = "<p>Não foi possível carregar este artigo. Volte ao arquivo e tente novamente.</p><p><a class=\"article-back\" href=\"index.html#recent-posts\">← Todos os artigos</a></p>";
  }
}

loadArticle();
