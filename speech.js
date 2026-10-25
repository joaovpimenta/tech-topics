(function (root) {
  "use strict";

  const letters = {
    "pt-BR": ["a", "bê", "cê", "dê", "ê", "éfe", "gê", "agá", "i", "jota", "cá", "éle", "ême", "êne", "ó", "pê", "quê", "érre", "ésse", "tê", "u", "vê", "dáblio", "xis", "ípsilon", "zê"],
    "en-US": ["ay", "bee", "see", "dee", "ee", "ef", "gee", "aitch", "eye", "jay", "kay", "el", "em", "en", "oh", "pee", "cue", "ar", "ess", "tee", "you", "vee", "double you", "ex", "why", "zee"]
  };
  const digits = { "pt-BR": ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"], "en-US": ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"] };
  const voiceStates = new WeakMap();

  function prepareVoices(synthesis = root.speechSynthesis) {
    if (!synthesis || (typeof synthesis !== "object" && typeof synthesis !== "function")) {
      return { snapshot: () => ({ state: "unavailable", voices: [] }), subscribe: () => () => {} };
    }
    const existing = voiceStates.get(synthesis);
    if (existing) return existing;
    let state = { state: "pending", voices: [] };
    const listeners = new Set();
    const publish = () => listeners.forEach(listener => listener(state));
    const refresh = () => {
      try {
        const voices = synthesis.getVoices();
        state = {
          state: voices.length
            ? (voices.some(voice => /^pt(?:-|$)/i.test(voice.lang || "")) ? "ready" : "missing-pt-br")
            : state.state === "pending" ? "pending" : "unavailable",
          voices
        };
      } catch (_) {
        state = { state: "unavailable", voices: [] };
      }
      publish();
    };
    const prepared = {
      snapshot: () => ({ ...state, voices: [...state.voices] }),
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
    };
    voiceStates.set(synthesis, prepared);
    try { synthesis.addEventListener?.("voiceschanged", refresh); } catch (_) {}
    refresh();
    const timeout = root.setTimeout?.(() => {
      if (state.state === "pending") {
        state = { state: "unavailable", voices: [] };
        publish();
      }
    }, 2500);
    timeout?.unref?.();
    return prepared;
  }

  // Prime the browser's voice list as the shell opens. This never speaks and
  // does not attempt to unlock autoplay.
  if (root.speechSynthesis) prepareVoices(root.speechSynthesis);

  function spell(text, lang = "pt-BR") {
    const language = lang.toLowerCase().startsWith("en") ? "en-US" : "pt-BR";
    return [...text].map(char => /[A-Za-z]/.test(char) ? letters[language][char.toUpperCase().charCodeAt(0) - 65] : /\d/.test(char) ? digits[language][Number(char)] : char).join(" ");
  }

  function validateLexicon(lexicon) {
    if (!lexicon || typeof lexicon !== "object" || Array.isArray(lexicon)) throw new Error("Léxico TTS inválido.");
    for (const [term, entry] of Object.entries(lexicon)) {
      if (!/^[\p{L}\p{N}]+$/u.test(term) || !entry || typeof entry.speak !== "string" || !entry.speak.trim() || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(entry.lang || "")) throw new Error(`Pronúncia TTS inválida: ${term}`);
    }
    return lexicon;
  }

  function pronounce(text, lang = "pt-BR", lexicon = {}) {
    const parts = [];
    let cursor = 0;
    // URLs and identifiers remain literal; replacement only happens at whole words.
    for (const match of text.matchAll(/https?:\/\/[^\s]+|www\.[^\s]+|[\p{L}\p{N}_]+/gu)) {
      const token = match[0];
      const plural = token.endsWith("s") && /^[a-z]?[A-Z][A-Z0-9]*s$/.test(token);
      const base = plural ? token.slice(0, -1) : token;
      const entry = Object.hasOwn(lexicon, token) ? lexicon[token] : plural && Object.hasOwn(lexicon, base) ? lexicon[base] : null;
      const initialism = /^[a-z]?[A-Z][A-Z0-9]*$/.test(base) && (base.match(/[A-Z]/g) || []).length >= 2;
      if (!entry && !initialism) continue;
      if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), lang, start: cursor, end: match.index, replacement: false });
      parts.push({ text: (entry?.speak || spell(base)) + (plural && !Object.hasOwn(lexicon, token) ? "s" : ""), lang: entry?.lang || "pt-BR", start: match.index, end: match.index + token.length, replacement: true });
      cursor = match.index + token.length;
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor), lang, start: cursor, end: text.length, replacement: false });
    return parts;
  }

  const blockSelector = "h1,h2,h3,h4,p,li,figcaption,th,td,.article-callout";
  const ignoredSelector = "pre,nav,button,input,select,textarea,script,style,svg,details,[hidden],[aria-hidden=true],[data-tts-ignore],.fgs-toc,.fgs-simulator,.fgs-formula,.mermaid-diagram,.mermaid-fallback,.article-back";
  // Keep ordinary inline code silent. Read only code with an explicit alias;
  // <pre> stays ignored (its descendants are never visited).
  function isNarrationIgnored(node) {
    return node.matches(ignoredSelector) ||
      (node.matches("code") && !node.getAttribute("data-tts-say"));
  }

  function readableText(node) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1 || isNarrationIgnored(node)) return "";
    if (node.matches("br,hr")) return " ";
    return [...node.childNodes].map(readableText).join("");
  }

  function isSentenceBoundary(text) {
    const value = String(text || "").trim().replace(/["”’'»)\]}]+$/u, "");
    return /[.!?…]$/u.test(value) &&
      !/^(?:sr|sra|dr|dra|prof|vs|ex|fig)\.$/iu.test(value);
  }

  // A Custom Highlight covers the entire DOM Range, including whitespace
  // text nodes between word spans and across inline markup. Styling each
  // .tts-word individually leaves visible unhighlighted gaps between words.
  function createSentenceHighlighter(document, fallbackClass = "tts-sentence-active") {
    const key = "tech-topics-current-sentence";
    const view = document?.defaultView;
    const registry = view?.CSS?.highlights;
    const Highlight = view?.Highlight;
    let fallbackWords = [];

    function clear() {
      registry?.delete?.(key);
      fallbackWords.forEach(word => word.classList.remove(fallbackClass));
      fallbackWords = [];
    }

    function set(words) {
      clear();
      if (!words?.length) return false;
      if (registry?.set && typeof Highlight === "function" &&
          typeof document.createRange === "function") {
        try {
          const range = document.createRange();
          range.setStartBefore(words[0]);
          range.setEndAfter(words[words.length - 1]);
          registry.set(key, new Highlight(range));
          return true;
        } catch (_) {
          registry.delete?.(key);
        }
      }
      // Older browsers fall back to word highlights rather than an
      // inaccurate whole-paragraph highlight.
      fallbackWords = [...new Set(words)];
      fallbackWords.forEach(word => word.classList.add(fallbackClass));
      return false;
    }

    return { set, clear };
  }

  function buildBlocks(roots, lexicon = {}) {
    const pieces = [];
    function visit(node, owner, language) {
      if (node.nodeType === 3) {
        if (!owner || !node.nodeValue) return;
        const fragment = node.ownerDocument.createDocumentFragment();
        for (const match of node.nodeValue.matchAll(/\s+|\S+/g)) {
          if (/^\s+$/.test(match[0])) {
            fragment.append(node.ownerDocument.createTextNode(match[0]));
            pieces.push({ owner, text: " ", lang: language, nodes: [] });
          } else {
            const word = node.ownerDocument.createElement("span");
            word.className = "tts-word";
            word.textContent = match[0];
            fragment.append(word);
            for (const part of pronounce(match[0], language, lexicon)) pieces.push({ owner, text: part.text, lang: part.lang, nodes: [word] });
          }
        }
        node.replaceWith(fragment);
        return;
      }
      if (node.nodeType !== 1 || isNarrationIgnored(node)) return;
      const lang = node.getAttribute("lang") || language;
      const block = node.matches(blockSelector) ? node : owner;
      if (node.matches("br,hr") && block) pieces.push({ owner: block, text: " ", lang, nodes: [] });
      const start = pieces.length;
      [...node.childNodes].forEach(child => visit(child, block, lang));
      const say = node.getAttribute("data-tts-say");
      const mode = node.getAttribute("data-tts-mode");
      if ((say || mode) && pieces.length > start) {
        const original = pieces.splice(start);
        const nodes = [...new Set(original.flatMap(piece => piece.nodes))];
        const literal = readableText(node);
        pieces.push({ owner: block, text: say || (mode === "spell" ? spell(literal, lang) : literal), lang, nodes });
      }
    }
    for (const rootNode of roots.filter(Boolean)) visit(rootNode, null, rootNode.closest("[lang]")?.lang || "pt-BR");
    const blocks = [];
    let block = null;
    let previousOwner = null;
    let sentenceIndex = 0;
    for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex += 1) {
      const piece = pieces[pieceIndex];
      if (piece.owner !== previousOwner) {
        previousOwner = piece.owner;
        sentenceIndex = 0;
        block = null;
      }
      let text = piece.text.replace(/\s+/g, " ");
      if (!block) {
        if (!text.trim()) continue;
        block = { node: piece.owner, sentenceIndex, segments: [], words: [] };
        blocks.push(block);
      }
      let segment = block.segments.at(-1);
      if (segment && /^[\s\p{P}]+$/u.test(text)) {
        segment.text += text;
      } else {
        if (!segment || segment.lang !== piece.lang || segment.text.length + text.length > 240) {
          if (!text.trim()) continue;
          if (segment) segment.text = segment.text.trimEnd();
          text = text.trimStart();
          segment = { text: "", lang: piece.lang, words: [] };
          block.segments.push(segment);
        }
        const start = segment.text.length;
        segment.text += text;
        if (piece.nodes.length) segment.words.push({ start, end: segment.text.length, nodes: piece.nodes });
      }
      for (const word of piece.nodes) if (!block.words.includes(word)) block.words.push(word);
      const finalWord = piece.nodes.at(-1);
      const nextPiece = pieces[pieceIndex + 1];
      // Replacements such as "API." produce multiple speech pieces for one
      // visible word; never split before its trailing punctuation is included.
      const stillSameWord = finalWord && nextPiece?.nodes?.includes(finalWord);
      if (finalWord && !stillSameWord && isSentenceBoundary(finalWord.textContent)) {
        block = null;
        sentenceIndex += 1;
      }
    }
    for (const unit of blocks) for (const segment of unit.segments) segment.text = segment.text.trimEnd();
    return blocks.filter(unit => unit.segments.length);

  }

  function createPlayer({ blocks, synthesis, Utterance, onChange = () => {}, onWord = () => {} }) {
    const voices = prepareVoices(synthesis);
    let rate = 1;
    let state = "idle";
    let blockIndex = 0;
    let segmentIndex = 0;
    let session = 0;
    let active = null;
    const snapshot = () => ({ state, blockIndex, count: blocks.length });
    const notify = message => onChange({ ...snapshot(), message });
    function cancel() {
      session += 1;
      active = null;
      synthesis.cancel();
      onWord([]);
    }
    function stop(message = "Leitura interrompida.") {
      cancel();
      state = "idle";
      blockIndex = segmentIndex = 0;
      notify(message);
    }
    function speak() {
      if (state !== "speaking") return;
      if (blockIndex >= blocks.length) return stop("Leitura concluída.");
      const segment = blocks[blockIndex].segments[segmentIndex];
      const currentSession = session;
      const utterance = new Utterance(segment.text);
      active = utterance;
      utterance.lang = segment.lang;
      utterance.rate = rate;
      utterance.pitch = 1;
      const availableVoices = voices.snapshot().voices;
      const language = segment.lang.toLowerCase();
      const voice = availableVoices.find(item => item.lang.toLowerCase() === language)
        || availableVoices.find(item => item.lang.toLowerCase().split("-")[0] === language.split("-")[0]);
      if (voice) utterance.voice = voice;
      utterance.onstart = () => { try { performance.mark("tt:device-onstart"); } catch (_) {} };
      utterance.onboundary = event => {
        if (currentSession !== session || active !== utterance || state !== "speaking" || event.name !== "word") return;
        const words = segment.words.filter(word => event.charIndex >= word.start && event.charIndex < word.end).flatMap(word => word.nodes);
        onWord(words);
      };
      utterance.onend = () => {
        if (currentSession !== session || active !== utterance) return;
        active = null;
        onWord([]);
        segmentIndex += 1;
        if (segmentIndex >= blocks[blockIndex].segments.length) {
          segmentIndex = 0;
          blockIndex += 1;
        }
        if (blockIndex >= blocks.length) return stop("Leitura concluída.");
        notify();
        speak();
      };
      utterance.onerror = event => {
        if (currentSession !== session || active !== utterance || event.error === "canceled" || event.error === "interrupted") return;
        stop("Não foi possível continuar a leitura neste navegador.");
      };
      notify();
      synthesis.speak(utterance);
    }
    function start(index = 0, paused = false) {
      if (!blocks.length) return notify("Não há texto disponível para leitura.");
      cancel();
      blockIndex = Math.max(0, Math.min(index, blocks.length - 1));
      segmentIndex = 0;
      state = paused ? "paused" : "speaking";
      notify();
      if (!paused) {
        synthesis.resume();
        speak();
      }
    }
    function seek(index) { start(index, state === "paused"); }
    function toggle() {
      if (state === "idle") return start();
      if (state === "speaking") {
        state = "paused";
        synthesis.pause();
        onWord([]);
      } else {
        state = "speaking";
        synthesis.resume();
        if (!active) speak();
      }
      notify();
    }
    function setRate(speed) {
      if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) return;
      if (speed === rate) return;
      rate = speed;
      if (state === "speaking" || state === "paused") start(blockIndex, state === "paused");
      else notify();
    }
    return { snapshot, start, toggle, seek, next: () => seek(blockIndex + 1), previous: () => seek(blockIndex - 1), stop, setRate, getRate: () => rate };
  }

  function mount({ document, lexicon = {}, synthesis = root.speechSynthesis, Utterance = root.SpeechSynthesisUtterance, dockMode = false, onStatus = () => {}, onAvailability = () => {} }) {
    const button = document.querySelector("#listen-article");
    const status = document.querySelector("#listen-status");
    const bar = document.querySelector("#speech-player");
    if (!synthesis || !Utterance) {
      if (!dockMode) button.hidden = true;
      status.textContent = "Leitura em voz alta não é compatível com este navegador.";
      return null;
    }
    const preparedVoices = prepareVoices(synthesis);
    const reportVoiceAvailability = snapshot => onAvailability({ ...snapshot, voices: snapshot.voices.map(voice => voice.lang) });
    reportVoiceAvailability(preparedVoices.snapshot());
    preparedVoices.subscribe(reportVoiceAvailability);
    const blocks = buildBlocks([document.querySelector("#article-heading"), document.querySelector("#article-dek"), document.querySelector("#article-body")], lexicon);
    if (dockMode) {
      let highlightedWords = [];
      const player = createPlayer({
        blocks, synthesis, Utterance,
        onWord(nodes) {
          highlightedWords.forEach(node => node.classList.remove("tts-word-active"));
          highlightedWords = [...new Set(nodes)];
          highlightedWords.forEach(node => node.classList.add("tts-word-active"));
        },
        onChange(snapshot) {
          status.textContent = snapshot.message || "";
          onStatus(snapshot);
        }
      });
      document.defaultView.addEventListener("pagehide", () => player.stop(""));
      return Object.assign(player, { blocks });
    }
    const play = document.querySelector("#speech-play");
    const previous = document.querySelector("#speech-previous");
    const next = document.querySelector("#speech-next");
    const stop = document.querySelector("#speech-stop");
    const position = document.querySelector("#speech-position");
    const follow = document.querySelector("#speech-follow");
    let selectedIndex = 0;
    let highlightedBlock = null;
    let highlightedSentence = [];
    const sentenceHighlighter = createSentenceHighlighter(document);
    let highlightedWords = [];
    let wasSpeaking = false;
    function measureBar() {
      if (!bar.hidden) document.body.style.setProperty("--speech-player-height", `${bar.getBoundingClientRect().height}px`);
    }
    if (document.defaultView.ResizeObserver) new document.defaultView.ResizeObserver(measureBar).observe(bar);
    function highlightWords(nodes) {
      highlightedWords.forEach(node => node.classList.remove("tts-word-active"));
      highlightedWords = [...new Set(nodes)];
      highlightedWords.forEach(node => node.classList.add("tts-word-active"));
    }
    const player = createPlayer({ blocks, synthesis, Utterance, onWord: highlightWords, onChange(snapshot) {
      const { state, blockIndex, count, message } = snapshot;
      const idle = state === "idle";
      const speaking = state === "speaking";
      if (speaking && !wasSpeaking) document.dispatchEvent(new Event("tech-topics:device-tts-start"));
      wasSpeaking = speaking;
      const returnFocus = idle && bar.contains(document.activeElement);
      bar.hidden = idle;
      if (returnFocus) button.focus({ preventScroll: true });
      measureBar();
      document.body.classList.toggle("speech-session", !idle);
      button.textContent = idle ? "Voz do dispositivo" : speaking ? "Pausar dispositivo" : "Continuar dispositivo";
      button.setAttribute("aria-pressed", String(!idle));
      button.setAttribute("aria-label", button.textContent);
      play.textContent = speaking ? "Pausar" : "Continuar";
      play.setAttribute("aria-label", speaking ? "Pausar leitura" : "Continuar leitura");
      previous.disabled = blockIndex === 0;
      next.disabled = blockIndex >= count - 1;
      position.textContent = `Trecho ${blockIndex + 1} de ${count}`;
      const currentBlock = idle ? null : blocks[blockIndex]?.node;
      const currentSentence = idle ? [] : blocks[blockIndex]?.words || [];
      if (highlightedSentence !== currentSentence) {
        highlightedSentence = currentSentence;
        sentenceHighlighter.set(currentSentence);
      }
      if (highlightedBlock !== currentBlock) {
        highlightedBlock?.classList.remove("tts-block-active");
        highlightedBlock = currentBlock;
        if (!highlightedSentence.length) highlightedBlock?.classList.add("tts-block-active");
        if (highlightedBlock && follow.checked) highlightedBlock.scrollIntoView({ behavior: "instant", block: "center" });
      }
      const label = message || (idle ? "" : speaking ? "Lendo o artigo em voz alta." : "Leitura pausada.");
      if (status.textContent !== label) status.textContent = label;
    } });
    button.addEventListener("click", () => player.toggle());
    play.addEventListener("click", () => player.toggle());
    previous.addEventListener("click", () => player.previous());
    next.addEventListener("click", () => player.next());
    stop.addEventListener("click", () => {
      player.stop();
      button.focus({ preventScroll: true });
    });
    for (const node of new Set(blocks.map(block => block.node))) {
      if (!node.hasAttribute("tabindex")) node.tabIndex = 0;
      node.setAttribute("aria-keyshortcuts", "Enter");
      node.classList.add("tts-readable");
      node.addEventListener("focus", () => {
        selectedIndex = blocks.findIndex(block => block.node === node);
      });
    }
    function chooseBlock(event) {
      if (event.target.closest("a,button,input,select,textarea,summary,pre,code,[contenteditable=true]")) return;
      if (document.defaultView.getSelection()?.toString()) return;
      const node = event.target.closest(blockSelector);
      const word = event.target.closest(".tts-word");
      let index = blocks.findIndex(block => block.node === node && word && block.words?.includes(word));
      if (index < 0) index = blocks.findIndex(block => block.node === node);
      if (index < 0) return;
      selectedIndex = index;
      if (event.type === "keydown") {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (player.snapshot().state === "idle") player.start(index);
        else player.seek(index);
      } else if (player.snapshot().state !== "idle") player.seek(index);
    }
    for (const rootNode of [document.querySelector(".article-header"), document.querySelector("#article-body")]) {
      rootNode.addEventListener("click", chooseBlock);
      rootNode.addEventListener("keydown", chooseBlock);
    }
    follow.addEventListener("change", () => {
      if (follow.checked) highlightedBlock?.scrollIntoView({ behavior: "instant", block: "center" });
    });
    document.defaultView.addEventListener("pagehide", () => player.stop(""));
    return player;
  }

  const api = { pronounce, spell, validateLexicon, prepareVoices, isSentenceBoundary, isNarrationIgnored, createSentenceHighlighter, createPlayer, buildBlocks, mount };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TechTopicsSpeech = api;
})(globalThis);
