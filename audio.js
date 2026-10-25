(function (root) {
  "use strict";

  const API_ROOT = "https://api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-";
  const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = String(total % 60).padStart(2, "0");
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
  }

  function normalizedChapters(data) {
    if (![1, 2].includes(data?.version) || !Array.isArray(data.chapters)) return [];
    const chapters = data.chapters
      .filter(item => item && Number.isFinite(item.start) && item.start >= 0)
      .map(item => ({
        start: item.start,
        blockIndex: Number.isSafeInteger(item.block_index) && item.block_index >= 0 ? item.block_index : null,
        sentenceIndex: data.version === 2 && Number.isSafeInteger(item.sentence_index) && item.sentence_index >= 0 ? item.sentence_index : null,
        label: typeof item.label === "string" ? item.label : ""
      }));
    if (chapters.length < 2 || chapters.some((chapter, i) => i && chapter.start <= chapters[i - 1].start)) return [];
    if (data.version === 2 && chapters.some(chapter => chapter.blockIndex === null || chapter.sentenceIndex === null)) return [];
    return chapters;
  }

  function chaptersFromNotes(notes) {
    if (typeof notes !== "string") return [];
    const found = notes.match(/<!-- TECH_TOPICS_CHAPTERS_V1\s*\n([^\n]+)\n-->/);
    if (!found) return [];
    try { return normalizedChapters(JSON.parse(found[1])); }
    catch (_) { return []; }
  }

  async function lookupAudio(slug, fetchImpl = root.fetch) {
    if (!SLUG.test(slug)) throw new Error("Slug de áudio inválida.");
    const response = await fetchImpl(API_ROOT + encodeURIComponent(slug), {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store"
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Consulta à Release indisponível.");
    const release = await response.json();
    const asset = name => release.assets?.some(item => item.name === name && item.state !== "deleted");
    const mp3 = `${slug}.mp3`;
    if (!asset(mp3)) return null;
    const base = `https://github.com/joaovpimenta/tech-topics/releases/download/tts-${slug}/`;
    const chapters = `${slug}.chapters.json`;
    return {
      url: base + mp3,
      chapters: chaptersFromNotes(release.body),
      chaptersUrl: asset(chapters) ? base + chapters : null
    };
  }

  async function findAudio(slug, fetchImpl = root.fetch) {
    return (await lookupAudio(slug, fetchImpl))?.url || null;
  }

  async function loadChapters(url, fetchImpl = root.fetch) {
    const response = await fetchImpl(url, { cache: "no-store" });
    if (!response.ok) return [];
    const data = await response.json();
    return normalizedChapters(data);
  }

  // Mirror the narration block traversal in kokoro_release.article_blocks().
  // Never guess a text/audio correspondence if the lists have drifted.
  function readingNodes(document) {
    const nodes = [];
    for (const id of ["#article-heading", "#article-dek"]) {
      const element = document.querySelector(id);
      if (element?.textContent?.trim()) nodes.push(element);
    }
    const root = document.querySelector("#article-body");
    const ignored = "pre,code,nav,button,details,script,style,svg,[hidden],[aria-hidden='true'],[data-tts-ignore],.article-back,.fgs-toc,.fgs-simulator,.fgs-formula,.mermaid-diagram,.mermaid-fallback";
    const block = "h2,h3,h4,p,figcaption,th,td";
    function visit(element) {
      if (element.nodeType !== 1 || element.matches(ignored)) return;
      const standaloneList = element.matches("li") && !element.querySelector("p");
      const standaloneCallout = element.matches("div.article-callout") && !element.querySelector("p");
      if (element.matches(block) || standaloneList || standaloneCallout) {
        if (element.textContent?.trim()) nodes.push(element);
        return;
      }
      for (const child of element.children) visit(child);
    }
    if (root) for (const child of root.children) visit(child);
    return nodes;
  }

  function createPlayer({ document, navigator, article, cover, audio, fetchAudio = lookupAudio, fetchChapters = loadChapters, devicePlayer = null, stopDevice = () => {}, startDevice = () => {}, playbackTimeoutMs = 1200 }) {
    const button = document.querySelector("#listen-recording");
    const inlineAnchor = document.querySelector("#inline-recording-anchor");
    const inlineTimeline = document.querySelector("#inline-recording-timeline");
    const inlinePlayer = document.querySelector("#inline-recording");
    const inlineSeek = document.querySelector("#inline-recording-seek");
    const inlineElapsed = document.querySelector("#inline-recording-elapsed");
    const inlineDuration = document.querySelector("#inline-recording-duration");
    const inlineRate = document.querySelector("#inline-recording-rate");
    const inlinePrevious = document.querySelector("#inline-recording-previous");
    const inlineNext = document.querySelector("#inline-recording-next");
    const dock = document.querySelector("#recording-player");
    const title = document.querySelector("#recording-title");
    const subtitle = document.querySelector("#recording-subtitle");
    const image = document.querySelector("#recording-cover");
    const ring = document.querySelector("#recording-ring");
    const playButton = document.querySelector("#recording-play");
    const previousButton = document.querySelector("#recording-previous");
    const skip = document.querySelector("#recording-skip");
    const follow = document.querySelector("#recording-follow");
    const closeButton = document.querySelector("#recording-close");
    const seek = document.querySelector("#recording-seek");
    const elapsed = document.querySelector("#recording-elapsed");
    const duration = document.querySelector("#recording-duration");
    const rate = document.querySelector("#recording-rate");
    const status = document.querySelector("#recording-status");
    const session = navigator.mediaSession;
    const deviceSwitch = document.querySelector("#listen-article");
    const sourceMenu = document.querySelector(".recording-options");
    let discovered = false;
    let recordedActive = false;
    let recordedPending = false;
    let recordedFallbackIndex;
    let playbackAttempt = 0;
    let cancelPendingPlayWait = null;
    let selectedRate = Number.isFinite(audio.playbackRate) ? audio.playbackRate : 1;
    let chapters = [];
    let chapterNodes = [];
    let chapterWords = [];
    let activeWords = [];
    // The speech module is loaded first on article.html. CommonJS fallback
    // keeps the same highlighter available to the Node regression tests.
    const highlighterFactory = root.TechTopicsSpeech?.createSentenceHighlighter ||
      (typeof module !== "undefined" && module.exports ?
        require("./speech.js").createSentenceHighlighter : null);
    const sentenceHighlighter = highlighterFactory?.(document, "recording-sentence-active");
    let activeNode = null;
    let activeIndex = -1;
    let open = false;
    let mode = null; // "recorded" or "device"; one dock owns both players.
    let deviceState = { state: "idle", blockIndex: 0, count: devicePlayer?.blocks?.length || 0 };
    let lastDeviceIndex = 0;
    let seeking = false;
    let inlineSeeking = false;
    let inlineVisible = true;
    // The transport buttons are never allowed to shrink or overlap the social
    // actions. Progress is an all-or-nothing accessory, measured after the
    // actual article grid allocates space and whenever its size changes.
    function updateInlineTimeline() {
      if (!inlineTimeline || !inlineAnchor || !inlinePlayer) return;
      const width = inlineAnchor.getBoundingClientRect?.().width || 0;
      if (!width) return; // article controls are still hidden during loading
      const gap = Number.parseFloat(root.getComputedStyle?.(inlinePlayer)?.gap) || 5;
      const controls = [button, inlinePrevious, inlineNext, inlineRate]
        .filter(node => node && !node.hidden);
      const defaults = [36, 22, 22, 52];
      const used = controls.reduce((total, node) => {
        const index = node === button ? 0 : node === inlineRate ? 3 : node === inlinePrevious ? 1 : 2;
        return total + (node.getBoundingClientRect?.().width || defaults[index]);
      }, 0);
      // Label lengths vary ("0:00", "1:25:00", "por trecho") and speed
      // labels vary ("1×", "1.25×", "2×"). Reserve a usable 56px seek track.
      const labels = (inlineElapsed?.textContent?.length || 4) +
        (inlineDuration?.textContent?.length || 5);
      const minTimeline = Math.max(120, Math.ceil(labels * 7) + 64);
      const fits = width >= used + minTimeline + gap * controls.length + 2;
      inlineTimeline.hidden = !fits;
      inlinePlayer.classList.toggle("has-timeline", fits);
    }

    if (inlineAnchor && inlineTimeline) {
      if (typeof root.ResizeObserver === "function") {
        new root.ResizeObserver(updateInlineTimeline).observe(inlineAnchor);
      }
      root.addEventListener?.("resize", updateInlineTimeline);
    }


    function updateDockVisibility() {
      // One audio element owns both interfaces; the existing bottom dock only
      // appears once the inline player has scrolled outside the viewport.
      const floating = open && (!inlineAnchor || !inlineVisible);
      document.body.classList.toggle("recording-open", floating);
      dock.hidden = !floating;
    }

    if (inlineAnchor) {
      if (typeof root.IntersectionObserver === "function") {
        const observer = new root.IntersectionObserver(entries => {
          if (!entries.length) return;
          inlineVisible = entries[0].isIntersecting;
          updateDockVisibility();
        }, { threshold: 0 });
        observer.observe(inlineAnchor);
      } else if (typeof root.addEventListener === "function") {
        const refresh = () => {
          const rect = inlineAnchor.getBoundingClientRect();
          inlineVisible = rect.bottom > 0 && rect.top < root.innerHeight;
          updateDockVisibility();
        };
        root.addEventListener("scroll", refresh, { passive: true });
        root.addEventListener("resize", refresh);
      }
    }

    function setStatus(message) {
      status.textContent = message || "";
    }
    function currentChapterIndex() {
      let index = 0;
      for (let i = 0; i < chapters.length; i += 1) {
        if (chapters[i].start > audio.currentTime + 0.08) break;
        index = i;
      }
      return index;
    }
    function fallbackDeviceIndex() {
      if (!devicePlayer?.blocks?.length || chapterNodes.length !== chapters.length || !chapters.length) return undefined;
      const chapterIndex = currentChapterIndex();
      if (Number.isSafeInteger(chapters[chapterIndex]?.sentenceIndex)) return chapterIndex;
      const node = chapterNodes[chapterIndex];
      const index = devicePlayer.blocks.findIndex(block => block.node === node);
      return index >= 0 ? index : undefined;
    }
    function clearHighlight() {
      activeNode?.classList.remove("recording-block-active");
      sentenceHighlighter?.clear();
      if (!sentenceHighlighter) activeWords.forEach(node => node.classList.remove("recording-sentence-active"));
      activeWords = [];
      activeNode = null;
      activeIndex = -1;
    }
    function followChapter() {
      let target = null;
      let index = -1;
      if (open && mode === "recorded" && chapterNodes.length && !audio.ended) {
        index = currentChapterIndex();
        target = chapterNodes[index];
      } else if (open && mode === "device" && deviceState.state !== "idle") {
        index = deviceState.blockIndex;
        target = devicePlayer?.blocks?.[index]?.node;
      }
      if (index === activeIndex && target === activeNode) return;
      clearHighlight();
      activeIndex = index;
      activeNode = target || null;
      activeWords = open && mode === "recorded" ? chapterWords[index] || [] :
        open && mode === "device" ? devicePlayer?.blocks?.[index]?.words || [] : [];
      if (activeWords.length) {
        if (sentenceHighlighter) sentenceHighlighter.set(activeWords);
        else activeWords.forEach(node => node.classList.add("recording-sentence-active"));
      } else activeNode?.classList.add("recording-block-active");
      if (activeNode && follow?.checked && document.visibilityState !== "hidden" && (!inlineAnchor || !inlineVisible)) {
        (activeWords[0] || activeNode).scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    function attachChapters() {
      const elements = readingNodes(document);
      const sentenceMode = chapters.every(chapter => chapter.sentenceIndex !== null);
      if (sentenceMode) {
        const units = devicePlayer?.blocks || [];
        // Never highlight a wrong sentence if spoken and visible boundaries drift.
        if (units.length !== chapters.length || !chapters.every((chapter, index) =>
          units[index]?.node === elements[chapter.blockIndex] &&
          units[index]?.sentenceIndex === chapter.sentenceIndex)) return;
        chapterNodes = units.map(unit => unit.node);
        chapterWords = units.map(unit => unit.words || []);
      } else {
        if (elements.length !== chapters.length || !chapters.every((chapter, index) =>
          chapter.blockIndex === null || chapter.blockIndex === index)) return;
        chapterNodes = elements;
        chapterWords = [];
      }
      for (const node of new Set(chapterNodes)) {
        node.classList.add("recording-readable");
        if (!node.hasAttribute("tabindex")) node.tabIndex = 0;
        if (!devicePlayer) {
          node.addEventListener("click", event => seekFromArticle(node, event));
          node.addEventListener("keydown", event => {
            if (event.key === "Enter") seekFromArticle(node, event);
          });
        }
      }
    }
    function seekFromArticle(node, event) {
      if (event.target.closest("a,button,input,select,textarea,summary,pre,code,[contenteditable=true]")) return;
      if (document.getSelection?.()?.toString()) return;
      if (event.type === "keydown") event.preventDefault();
      const word = event.target.closest?.(".tts-word");
      const sentence = devicePlayer?.blocks?.findIndex(block =>
        block.node === node && word && block.words?.includes(word)) ?? -1;
      const index = sentence >= 0 ? sentence : devicePlayer?.blocks?.findIndex(block => block.node === node) ?? -1;
      if (mode === "device" && index >= 0) {
        beginDevice(index);
        return;
      }
      const matchingChapter = chapterNodes.findIndex((item, index) =>
        item === node && word && chapterWords[index]?.includes(word));
      const chapter = matchingChapter >= 0 ? matchingChapter : chapterNodes.indexOf(node);
      if (discovered && chapter >= 0) {
        seekTo(chapters[chapter].start);
        if (mode !== "recorded" || audio.paused || !open) void play();
      } else if (index >= 0) {
        beginDevice(index);
      }
    }
    function attachReadingHandlers() {
      if (!devicePlayer?.blocks) return;
      for (const node of new Set(devicePlayer.blocks.map(block => block.node))) {
        if (!node.hasAttribute("tabindex")) node.tabIndex = 0;
        node.classList.add("recording-readable");
        node.addEventListener("click", event => seekFromArticle(node, event));
        node.addEventListener("keydown", event => {
          if (event.key === "Enter") seekFromArticle(node, event);
        });
      }
    }
    function beginDevice(index) {
      if (!devicePlayer) {
        cancelRecordedAttempt();
        audio.pause();
        mode = null;
        open = false;
        startDevice(index);
        render();
        return;
      }
      cancelRecordedAttempt();
      if (mode === "recorded" && Number.isFinite(audio.playbackRate)) selectedRate = audio.playbackRate;
      const targetIndex = Number.isInteger(index) ? index : lastDeviceIndex;
      devicePlayer.setRate?.(selectedRate);
      mode = "device";
      open = true;
      audio.pause();
      clearSession();
      if (Number.isInteger(targetIndex)) devicePlayer.start(targetIndex);
      else if (devicePlayer.snapshot().state === "idle") devicePlayer.start();
      else devicePlayer.toggle();
      render();
    }
    function deviceChanged(snapshot) {
      deviceState = snapshot;
      if (snapshot.state !== "idle") lastDeviceIndex = snapshot.blockIndex;
      else if (snapshot.message === "Leitura concluída.") lastDeviceIndex = 0;
      if (mode !== "device") return;
      if (snapshot.state === "idle") {
        open = false;
        mode = null;
        clearHighlight();
      }
      render();
    }
    function nextParagraph() {
      if (mode === "device") return devicePlayer?.next();
      const target = chapters.find(chapter => chapter.start > audio.currentTime + 0.7);
      if (target) seekTo(target.start);
    }
    function previousParagraph() {
      if (mode === "device") return devicePlayer?.previous();
      const previous = chapters.filter(chapter => chapter.start < audio.currentTime - 2);
      if (previous.length) seekTo(previous[previous.length - 1].start);
      else if (chapters.length) seekTo(chapters[0].start);
    }
    function render() {
      const native = mode === "device";
      const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      const total = Number.isFinite(audio.duration) ? audio.duration : 0;
      const fraction = native
        ? (deviceState.count > 1 ? deviceState.blockIndex / (deviceState.count - 1) : 0)
        : (total > 0 ? Math.min(1, Math.max(0, current / total)) : 0);
      const devicePosition = deviceState.count ? `${deviceState.blockIndex + 1}/${deviceState.count}` : "—";
      if (!seeking) {
        seek.value = String(Math.round(fraction * 1000));
        elapsed.textContent = native ? devicePosition : formatTime(current);
      }
      duration.textContent = native ? "por trecho" : total > 0 ? formatTime(total) : "–:––";
      seek.disabled = native ? deviceState.count < 2 : total <= 0;
      seek.setAttribute("aria-label", native ? "Navegar pelos trechos do artigo" : "Posição da narração");
      ring.style.setProperty("--recording-progress", `${Math.round(fraction * 360)}deg`);
      const playing = native ? deviceState.state === "speaking" : recordedActive && !audio.paused && !audio.ended && mode === "recorded";
      playButton.setAttribute("aria-label", playing ? "Pausar narração" : "Reproduzir narração");
      playButton.setAttribute("aria-pressed", String(playing));
      playButton.dataset.playing = String(playing);
      button.setAttribute("aria-label", playing ? "Pausar áudio do artigo" : "Reproduzir áudio do artigo");
      button.setAttribute("aria-pressed", String(playing));
      button.dataset.playing = String(playing);
      const inlineLabel = button.querySelector(".recording-button-label");
      if (inlineLabel) inlineLabel.textContent = playing ? "Pausar artigo" : "Ouvir artigo";
      if (inlineSeek) {
        if (!inlineSeeking) inlineSeek.value = String(Math.round(fraction * 1000));
        inlineSeek.disabled = native ? deviceState.count < 2 : total <= 0;
        inlineSeek.setAttribute("aria-label", native ? "Navegar pelos trechos do artigo" : "Posição da narração");
      }
      if (inlineElapsed && !inlineSeeking) inlineElapsed.textContent = native ? devicePosition : formatTime(current);
      if (inlineDuration) inlineDuration.textContent = native ? "por trecho" : total > 0 ? formatTime(total) : "–:––";
      subtitle.textContent = native ? "Tech Topics · Voz do dispositivo" : "Tech Topics · Narração";
      const count = native ? deviceState.count : chapters.length;
      previousButton.hidden = skip.hidden = count < 2;
      previousButton.disabled = native ? deviceState.blockIndex <= 0 : count < 2 || current < 0.7;
      skip.disabled = native ? deviceState.blockIndex >= count - 1 : !chapters.some(chapter => chapter.start > current + 0.7);
      if (inlinePrevious) {
        inlinePrevious.hidden = previousButton.hidden;
        inlinePrevious.disabled = previousButton.disabled;
      }
      if (inlineNext) {
        inlineNext.hidden = skip.hidden;
        inlineNext.disabled = skip.disabled;
      }
      const playbackRate = native ? devicePlayer?.getRate?.() || selectedRate : audio.playbackRate;
      selectedRate = playbackRate;
      rate.textContent = `${playbackRate}×`;
      rate.setAttribute("aria-label", `Velocidade da narração: ${playbackRate} vezes`);
      if (inlineRate) {
        inlineRate.textContent = rate.textContent;
        inlineRate.setAttribute("aria-label", `Velocidade da narração: ${playbackRate} vezes`);
      }
      if (deviceSwitch) {
        deviceSwitch.textContent = native ? "Usar áudio gravado" : "Usar voz do dispositivo";
        deviceSwitch.hidden = native ? !discovered : !devicePlayer;
      }
      if (sourceMenu) sourceMenu.hidden = !discovered || !devicePlayer;
      updateInlineTimeline();
      followChapter();
      updateDockVisibility();
      if (session && !native) session.playbackState = playing ? "playing" : open ? "paused" : "none";
    }
    function updatePosition() {
      if (!session?.setPositionState || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
      try {
        session.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: Math.max(0, Math.min(audio.currentTime, audio.duration))
        });
      } catch (_) { /* Some browsers expose incomplete Media Session support. */ }
    }
    function seekTo(position) {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      if (recordedPending) {
        cancelRecordedAttempt();
        audio.pause();
        setStatus("Reprodução pausada.");
      }
      audio.currentTime = Math.min(audio.duration, Math.max(0, position));
      render();
      updatePosition();
    }
    function configureSession() {
      if (!session) return;
      if (typeof root.MediaMetadata === "function") {
        try {
          session.metadata = new root.MediaMetadata({
            title: article.title,
            artist: "Tech Topics · Narração",
            album: "Tech Topics",
            artwork: [{ src: new URL(cover.src, document.baseURI).href }]
          });
        } catch (_) { /* Invalid metadata must never prevent MP3 playback. */ }
      }
      const handlers = {
        play: () => { void play(); },
        pause: pauseRecorded,
        stop: () => close(),
        seekto: details => seekTo(details.seekTime),
        ...(chapters.length > 1 ? {
          previoustrack: previousParagraph,
          nexttrack: nextParagraph,
          seekbackward: previousParagraph,
          seekforward: nextParagraph
        } : {})
      };
      for (const [action, handler] of Object.entries(handlers)) {
        try { session.setActionHandler(action, handler); }
        catch (_) { /* Unsupported lock-screen action: native playback continues. */ }
      }
      updatePosition();
    }
    function clearSession() {
      if (!session) return;
      for (const action of ["play", "pause", "stop", "seekbackward", "seekforward", "seekto", "previoustrack", "nexttrack"]) {
        try { session.setActionHandler(action, null); } catch (_) {}
      }
      session.playbackState = "none";
      session.metadata = null;
    }
    function cancelRecordedAttempt() {
      playbackAttempt += 1;
      recordedPending = false;
      recordedActive = false;
      const cancel = cancelPendingPlayWait;
      cancelPendingPlayWait = null;
      cancel?.();
    }
    function hasRecordedIntent() {
      return mode === "recorded" && open && (recordedPending || recordedActive);
    }
    function mediaReadyAtCurrentPosition() {
      const readyState = Number(audio.readyState);
      if (!Number.isFinite(readyState) || readyState < 2 || !Number.isFinite(audio.duration) || audio.duration <= 0) return false;
      const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      const containsPosition = ranges => {
        if (!ranges || !Number.isFinite(ranges.length) || ranges.length < 1) return false;
        try {
          for (let index = 0; index < ranges.length; index += 1) {
            if (ranges.start(index) <= position + 0.05 && ranges.end(index) >= position - 0.05) return true;
          }
        } catch (_) { return false; }
        return false;
      };
      if (!containsPosition(audio.buffered) || !containsPosition(audio.seekable)) return false;
      return true;
    }
    function waitForRecordedStart(attempt) {
      return new Promise(resolve => {
        let settled = false;
        let started = false;
        let timer;
        const finish = result => {
          if (settled) return;
          settled = true;
          started = result;
          const isCurrentAttempt = attempt === playbackAttempt;
          if (isCurrentAttempt) recordedActive = result;
          clearTimeout(timer);
          audio.removeEventListener("playing", onPlaying);
          if (cancelPendingPlayWait === cancel) cancelPendingPlayWait = null;
          if (!result && (isCurrentAttempt || !hasRecordedIntent())) audio.pause();
          resolve(result);
        };
        const cancel = () => finish(false);
        const onPlaying = () => {
          const isObsolete = attempt !== playbackAttempt;
          if (isObsolete || mode !== "recorded" || !open) {
            if (!isObsolete || !hasRecordedIntent()) audio.pause();
            finish(false);
          } else finish(true);
        };
        cancelPendingPlayWait = cancel;
        audio.addEventListener("playing", onPlaying);
        timer = setTimeout(() => finish(false), playbackTimeoutMs);
        let result;
        try { result = audio.play(); }
        catch (_) { finish(false); return; }
        Promise.resolve(result).then(() => {
          const isObsolete = attempt !== playbackAttempt;
          if (settled && !started || isObsolete || mode !== "recorded" || !open) {
            if (!isObsolete || !hasRecordedIntent()) audio.pause();
            finish(false);
            return;
          }
          finish(!audio.paused && !audio.ended);
        }, () => finish(false));
        if (result === undefined && !audio.paused && !audio.ended) finish(true);
      });
    }
    function fallbackToDevice(message, index, attempt) {
      if (attempt !== playbackAttempt) {
        if (!hasRecordedIntent()) audio.pause();
        return;
      }
      cancelRecordedAttempt();
      audio.pause();
      if (devicePlayer) {
        setStatus(message);
        beginDevice(index);
      } else {
        mode = null;
        open = false;
        clearSession();
        clearHighlight();
        setStatus("O MP3 ainda não iniciou. Verifique a conexão e tente novamente.");
        render();
      }
    }
    async function play() {
      try { performance.mark("tt:audio-play-request"); } catch (_) {}
      if (!discovered) return beginDevice();
      if (mode === "device") {
        selectedRate = devicePlayer?.getRate?.() || selectedRate;
        lastDeviceIndex = deviceState.blockIndex;
      }
      const fallbackBlock = mode === "device" ? lastDeviceIndex : fallbackDeviceIndex();
      recordedFallbackIndex = fallbackBlock;
      cancelRecordedAttempt();
      const attempt = playbackAttempt;
      recordedActive = false;
      recordedPending = true;
      mode = "recorded";
      open = true;
      audio.playbackRate = selectedRate;
      if (devicePlayer) devicePlayer.stop("");
      else stopDevice();
      render();
      configureSession();
      if (!mediaReadyAtCurrentPosition()) {
        if (devicePlayer) {
          fallbackToDevice("MP3 encontrado, mas a mídia ainda não está pronta; usando voz do dispositivo.", fallbackBlock, attempt);
          return;
        }
        setStatus("Carregando áudio gravado…");
      } else {
        setStatus("Aguardando início do MP3…");
      }
      const started = await waitForRecordedStart(attempt);
      if (attempt !== playbackAttempt) {
        if (!hasRecordedIntent()) audio.pause();
        return;
      }
      recordedPending = false;
      if (started) setStatus("");
      else fallbackToDevice("Não foi possível iniciar o MP3; usando voz do dispositivo.", fallbackBlock, attempt);
      render();
    }
    function close() {
      cancelRecordedAttempt();
      mode = null;
      open = false;
      audio.pause();
      devicePlayer?.stop("");
      clearSession();
      clearHighlight();
      render();
      setStatus("");
    }
    function stop() {
      close();
    }
    function pauseRecorded() {
      if (recordedPending) {
        cancelRecordedAttempt();
        setStatus("Reprodução pausada.");
      }
      audio.pause();
      render();
    }
    function togglePlayback() {
      if (mode === "device") return devicePlayer?.toggle();
      if (!discovered) return beginDevice();
      if (mode === "recorded" && recordedPending) return pauseRecorded();
      if (mode === "recorded" && !audio.paused && !audio.ended) pauseRecorded();
      else void play();
    }
    button.addEventListener("click", togglePlayback);
    playButton.addEventListener("click", togglePlayback);
    deviceSwitch?.addEventListener("click", () => {
      if (sourceMenu) sourceMenu.open = false;
      if (mode === "device" && discovered) void play();
      else beginDevice();
    });
    skip.addEventListener("click", nextParagraph);
    previousButton.addEventListener("click", previousParagraph);
    inlinePrevious?.addEventListener("click", previousParagraph);
    inlineNext?.addEventListener("click", nextParagraph);
    follow?.addEventListener("change", () => {
      if (follow.checked && activeNode && document.visibilityState !== "hidden") {
        (activeWords[0] || activeNode).scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    closeButton.addEventListener("click", close);
    seek.addEventListener("input", () => {
      seeking = true;
      elapsed.textContent = mode === "device"
        ? `${Math.round(Number(seek.value) / 1000 * Math.max(0, deviceState.count - 1)) + 1}/${deviceState.count}`
        : formatTime(Number(seek.value) / 1000 * (audio.duration || 0));
    });
    seek.addEventListener("change", () => {
      if (mode === "device") devicePlayer?.seek(Math.round(Number(seek.value) / 1000 * Math.max(0, deviceState.count - 1)));
      else seekTo(Number(seek.value) / 1000 * audio.duration);
      seeking = false;
      render();
    });
    inlineSeek?.addEventListener("input", () => {
      inlineSeeking = true;
      const percent = Number(inlineSeek.value) / 1000;
      if (inlineElapsed) inlineElapsed.textContent = mode === "device"
        ? `${Math.round(percent * Math.max(0, deviceState.count - 1)) + 1}/${deviceState.count}`
        : formatTime(percent * (audio.duration || 0));
    });
    inlineSeek?.addEventListener("change", () => {
      const percent = Number(inlineSeek.value) / 1000;
      if (mode === "device") devicePlayer?.seek(Math.round(percent * Math.max(0, deviceState.count - 1)));
      else seekTo(percent * audio.duration);
      inlineSeeking = false;
      render();
    });
    inlineRate?.addEventListener("click", () => rate.click());
    rate.addEventListener("click", () => {
      const speeds = [1, 1.25, 1.5, 1.75, 2];
      selectedRate = speeds[(speeds.indexOf(selectedRate) + 1) % speeds.length];
      audio.playbackRate = selectedRate;
      if (mode === "device" && devicePlayer) {
        devicePlayer.setRate?.(selectedRate);
      }
      updatePosition();
      render();
    });
    audio.addEventListener("loadedmetadata", () => { try { performance.mark("tt:audio-metadata"); } catch (_) {} render(); updatePosition(); });
    audio.addEventListener("canplay", () => { try { performance.mark("tt:audio-canplay"); } catch (_) {} });
    audio.addEventListener("durationchange", () => { render(); updatePosition(); });
    audio.addEventListener("timeupdate", () => { if (mode === "recorded") render(); });
    audio.addEventListener("seeking", render);
    audio.addEventListener("seeked", updatePosition);
    audio.addEventListener("ratechange", updatePosition);
    audio.addEventListener("play", () => {
      try { performance.mark("tt:audio-play"); } catch (_) {}
      if (mode !== "recorded" || !open || (!recordedPending && !recordedActive)) { audio.pause(); return; }
      render(); updatePosition();
    });
    audio.addEventListener("playing", () => {
      try { performance.mark("tt:audio-playing"); } catch (_) {}
      if (mode !== "recorded" || !open || (!recordedPending && !recordedActive)) { audio.pause(); return; }
    });
    audio.addEventListener("pause", () => {
      if (mode === "recorded") {
        if (!recordedPending) recordedActive = false;
        render(); updatePosition();
      }
    });
    audio.addEventListener("ended", () => { if (mode === "recorded") { render(); updatePosition(); } });
    audio.addEventListener("error", () => {
      if (mode === "recorded" && open && (recordedPending || recordedActive)) {
        const fallbackIndex = recordedPending ? recordedFallbackIndex : fallbackDeviceIndex();
        if (devicePlayer) fallbackToDevice("Falha no áudio gravado; usando voz do dispositivo.", fallbackIndex, playbackAttempt);
        else fallbackToDevice("Falha ao carregar o MP3. Verifique a conexão e tente novamente.", fallbackIndex, playbackAttempt);
      }
      else {
        setStatus("Falha ao carregar o áudio gravado. Use a voz do dispositivo.");
        audio.pause();
        render();
      }
    });
    title.textContent = article.title;
    subtitle.textContent = "Tech Topics · Narração";
    image.src = cover.src;
    image.alt = "";
    audio.preload = "metadata";
    audio.playsInline = true;

    async function discover() {
      try {
        const source = await fetchAudio(article.slug);
        try { performance.mark("tt:audio-discovery-complete"); } catch (_) {}
        if (!source) return;
        audio.src = typeof source === "string" ? source : source.url;
        discovered = true;
        if (typeof source === "object") {
          chapters = Array.isArray(source.chapters) ? normalizedChapters({
            version: source.chapters.some(item => item.sentenceIndex != null || item.sentence_index != null) ? 2 : 1,
            chapters: source.chapters.map(item => ({
              ...item, block_index: item.blockIndex ?? item.block_index,
              sentence_index: item.sentenceIndex ?? item.sentence_index
            }))
          }) : [];
          if (!chapters.length && source.chaptersUrl) {
            try { chapters = await fetchChapters(source.chaptersUrl); }
            catch (_) { chapters = []; }
          }
        }
        if (chapters.length) attachChapters();
        render();
      } catch (_) {
        setStatus("Não foi possível verificar se existe áudio gravado.");
      }
    }
    attachReadingHandlers();
    render();
    if (typeof root.addEventListener === "function") root.addEventListener("pagehide", close);
    return { discover, play, stop, close, beginDevice, deviceChanged, snapshot: () => ({
      available: discovered, discovered, mediaReady: mediaReadyAtCurrentPosition(), recordedPending, open, mode,
      playing: mode === "device" ? deviceState.state === "speaking" : recordedActive && !audio.paused && mode === "recorded"
    }) };
  }

  const api = { findAudio, lookupAudio, loadChapters, chaptersFromNotes, readingNodes, formatTime, createPlayer };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TechTopicsAudio = api;
})(globalThis);
