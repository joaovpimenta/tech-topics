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
    if (data?.version !== 1 || !Array.isArray(data.chapters)) return [];
    const chapters = data.chapters
      .filter(item => item && Number.isFinite(item.start) && item.start >= 0)
      .map(item => ({
        start: item.start,
        blockIndex: Number.isSafeInteger(item.block_index) && item.block_index >= 0 ? item.block_index : null,
        label: typeof item.label === "string" ? item.label : ""
      }));
    if (chapters.length < 2 || chapters.some((chapter, i) => i && chapter.start <= chapters[i - 1].start)) return [];
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

  function createPlayer({ document, navigator, article, cover, audio, fetchAudio = lookupAudio, fetchChapters = loadChapters, devicePlayer = null, stopDevice = () => {}, startDevice = () => {} }) {
    const button = document.querySelector("#listen-recording");
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
    let available = false;
    let chapters = [];
    let chapterNodes = [];
    let activeNode = null;
    let activeIndex = -1;
    let open = false;
    let mode = null; // "recorded" or "device"; one dock owns both players.
    let deviceState = { state: "idle", blockIndex: 0, count: devicePlayer?.blocks?.length || 0 };
    let seeking = false;

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
    function clearHighlight() {
      activeNode?.classList.remove("recording-block-active");
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
      activeNode?.classList.add("recording-block-active");
      if (activeNode && follow?.checked && document.visibilityState !== "hidden") {
        activeNode.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    function attachChapters() {
      const elements = readingNodes(document);
      if (elements.length !== chapters.length || !chapters.every((chapter, index) =>
        chapter.blockIndex === null || chapter.blockIndex === index)) return;
      chapterNodes = elements;
      elements.forEach(node => {
        node.classList.add("recording-readable");
        if (!node.hasAttribute("tabindex")) node.tabIndex = 0;
        if (!devicePlayer) {
          node.addEventListener("click", event => seekFromArticle(node, event));
          node.addEventListener("keydown", event => {
            if (event.key === "Enter") seekFromArticle(node, event);
          });
        }
      });
    }
    function seekFromArticle(node, event) {
      if (event.target.closest("a,button,input,select,textarea,summary,pre,code,[contenteditable=true]")) return;
      if (document.getSelection?.()?.toString()) return;
      if (event.type === "keydown") event.preventDefault();
      const index = devicePlayer?.blocks?.findIndex(block => block.node === node) ?? -1;
      if (mode === "device" && index >= 0) {
        beginDevice(index);
        return;
      }
      const chapter = chapterNodes.indexOf(node);
      if (available && chapter >= 0) {
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
      if (!devicePlayer) return startDevice(index);
      mode = "device";
      open = true;
      audio.pause();
      clearSession();
      if (Number.isInteger(index)) devicePlayer.start(index);
      else if (devicePlayer.snapshot().state === "idle") devicePlayer.start();
      else devicePlayer.toggle();
      render();
    }
    function deviceChanged(snapshot) {
      deviceState = snapshot;
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
      const playing = native ? deviceState.state === "speaking" : !audio.paused && !audio.ended && mode === "recorded";
      playButton.setAttribute("aria-label", playing ? "Pausar narração" : "Reproduzir narração");
      playButton.setAttribute("aria-pressed", String(playing));
      playButton.dataset.playing = String(playing);
      button.setAttribute("aria-label", playing ? "Pausar áudio do artigo" : "Ouvir artigo");
      button.setAttribute("aria-pressed", String(playing));
      button.querySelector(".recording-button-label").textContent = "Ouvir artigo";
      subtitle.textContent = native ? "Tech Topics · Voz do dispositivo" : "Tech Topics · Narração";
      const count = native ? deviceState.count : chapters.length;
      previousButton.hidden = skip.hidden = count < 2;
      previousButton.disabled = native ? deviceState.blockIndex <= 0 : count < 2 || current < 0.7;
      skip.disabled = native ? deviceState.blockIndex >= count - 1 : !chapters.some(chapter => chapter.start > current + 0.7);
      rate.textContent = `${native ? devicePlayer?.getRate?.() || 1 : audio.playbackRate}×`;
      if (deviceSwitch) {
        deviceSwitch.textContent = native ? "Usar áudio gravado" : "Usar voz do dispositivo";
        deviceSwitch.hidden = native ? !available : !devicePlayer;
      }
      followChapter();
      document.body.classList.toggle("recording-open", open);
      dock.hidden = !open;
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
        pause: () => audio.pause(),
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
    async function play() {
      if (!available) return beginDevice();
      mode = "recorded";
      open = true;
      if (devicePlayer) devicePlayer.stop("");
      else stopDevice();
      render();
      configureSession();
      try {
        await audio.play();
        setStatus("");
      } catch (_) {
        setStatus("Não foi possível reproduzir o MP3. Tente novamente ou use a voz do dispositivo.");
        render();
      }
    }
    function close() {
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
    function togglePlayback() {
      if (mode === "device") return devicePlayer?.toggle();
      if (!available) return beginDevice();
      if (mode === "recorded" && !audio.paused && !audio.ended) audio.pause();
      else void play();
    }
    button.addEventListener("click", togglePlayback);
    playButton.addEventListener("click", togglePlayback);
    deviceSwitch?.addEventListener("click", () => {
      if (sourceMenu) sourceMenu.open = false;
      if (mode === "device" && available) void play();
      else beginDevice();
    });
    skip.addEventListener("click", nextParagraph);
    previousButton.addEventListener("click", previousParagraph);
    follow?.addEventListener("change", () => {
      if (follow.checked && activeNode && document.visibilityState !== "hidden") {
        activeNode.scrollIntoView({ behavior: "smooth", block: "center" });
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
    rate.addEventListener("click", () => {
      const speeds = [1, 1.25, 1.5, 1.75, 2];
      if (mode === "device" && devicePlayer) {
        const current = devicePlayer.getRate?.() || 1;
        devicePlayer.setRate?.(speeds[(speeds.indexOf(current) + 1) % speeds.length]);
      } else {
        audio.playbackRate = speeds[(speeds.indexOf(audio.playbackRate) + 1) % speeds.length];
        updatePosition();
      }
      const value = mode === "device" ? devicePlayer?.getRate?.() || 1 : audio.playbackRate;
      rate.textContent = `${value}×`;
      rate.setAttribute("aria-label", `Velocidade da narração: ${value} vezes`);
      render();
    });
    audio.addEventListener("loadedmetadata", () => { render(); updatePosition(); });
    audio.addEventListener("durationchange", () => { render(); updatePosition(); });
    audio.addEventListener("timeupdate", () => { if (mode === "recorded") render(); });
    audio.addEventListener("seeking", render);
    audio.addEventListener("seeked", updatePosition);
    audio.addEventListener("ratechange", updatePosition);
    audio.addEventListener("play", () => { if (mode === "recorded") { render(); updatePosition(); } });
    audio.addEventListener("pause", () => { if (mode === "recorded") { render(); updatePosition(); } });
    audio.addEventListener("ended", () => { if (mode === "recorded") { render(); updatePosition(); } });
    audio.addEventListener("error", () => {
      setStatus("Falha ao carregar o áudio gravado. Use a voz do dispositivo.");
      audio.pause();
      render();
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
        if (!source) return;
        audio.src = typeof source === "string" ? source : source.url;
        available = true;
        if (typeof source === "object") {
          chapters = Array.isArray(source.chapters) ? normalizedChapters({ version: 1, chapters: source.chapters.map(item => ({
            ...item, block_index: item.blockIndex ?? item.block_index
          })) }) : [];
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
    return { discover, play, stop, close, beginDevice, deviceChanged, snapshot: () => ({
      available, open, mode, playing: mode === "device" ? deviceState.state === "speaking" : !audio.paused && mode === "recorded"
    }) };
  }

  const api = { findAudio, lookupAudio, loadChapters, chaptersFromNotes, readingNodes, formatTime, createPlayer };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TechTopicsAudio = api;
})(globalThis);
