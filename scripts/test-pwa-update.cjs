const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

async function testWorkerActivationMessage() {
  const handlers = {};
  let skipWaitingCalls = 0;
  const context = vm.createContext({
    URL, Request, Response,
    importScripts() {
      vm.runInContext(readFileSync("sw-version.js", "utf8"), context);
    },
    self: {
      location: { href: "https://example.test/tech-topics/sw.js" },
      addEventListener(type, handler) { handlers[type] = handler; },
      async skipWaiting() { skipWaitingCalls++; },
      clients: { async claim() { throw new Error("updates must not claim other tabs"); } }
    }
  });
  vm.runInContext(readFileSync("sw.js", "utf8"), context);
  let response;
  let pending;
  handlers.message({ data: { type: "UNRELATED" }, ports: [{ postMessage() { throw new Error("unexpected response"); } }], waitUntil() {} });
  assert.equal(skipWaitingCalls, 0, "the worker ignores unrelated messages");
  handlers.message({ data: { type: "TECH_TOPICS_ACTIVATE_UPDATE" }, ports: [{ postMessage(value) { response = value; } }], waitUntil(promise) { pending = promise; } });
  await pending;
  assert.equal(skipWaitingCalls, 1, "only the explicit page action invokes skipWaiting");
  assert.equal(response.ok, true);
}

function createPage({ waiting = true, controlled = true, activePlayback = false, supported = true, messageChannel = true } = {}) {
  const windowHandlers = {};
  const workerHandlers = {};
  const pageChildren = [];
  const posts = [];
  let reloads = 0;
  let playback = activePlayback;
  const node = tagName => ({
    tagName, children: [], attrs: {}, listeners: {}, style: {}, hidden: false, disabled: false,
    textContent: "", setAttribute(name, value) { this.attrs[name] = value; },
    append(...children) { this.children.push(...children); },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    querySelector(selector) {
      if (selector === "button") return this.children.find(child => child.tagName === "button") || null;
      if (selector === "[data-update-status]") return this.children.find(child => child.attrs["data-update-status"] !== undefined) || null;
      return null;
    },
    click() { return this.listeners.click?.(); }
  });
  const port = { onmessage: null, close() {} };
  class MessageChannelMock { constructor() { this.port1 = port; this.port2 = { peer: port }; } }
  const worker = {
    state: "installed",
    addEventListener(type, handler) { (workerHandlers[type] ||= []).push(handler); },
    postMessage(message, ports) { posts.push(message); this.responsePort = ports[0].peer; }
  };
  const registration = {
    waiting: waiting ? worker : null,
    active: controlled ? {} : null,
    installing: null,
    addEventListener(type, handler) { (workerHandlers[`registration:${type}`] ||= []).push(handler); }
  };
  const serviceWorker = {
    controller: controlled ? {} : null,
    register: async () => registration,
    addEventListener(type, handler) { (workerHandlers[`serviceWorker:${type}`] ||= []).push(handler); }
  };
  const window = {
    location: { href: "https://example.test/tech-topics/article.html?slug=bulkhead#limits", reload() { reloads++; } },
    speechSynthesis: { speaking: false, pending: false }, MessageChannel: messageChannel ? MessageChannelMock : undefined,
    addEventListener(type, handler) { windowHandlers[type] = handler; }
  };
  const document = {
    body: { append(child) { pageChildren.push(child); } },
    querySelector() { return null; },
    querySelectorAll() { return playback ? [{ paused: false, ended: false }] : []; },
    getElementById(id) { return pageChildren.find(child => child.id === id) || null; },
    createElement: node
  };
  const navigator = supported ? { serviceWorker } : {};
  vm.runInNewContext(readFileSync("pwa.js", "utf8"), { document, window, navigator, console, setTimeout, clearTimeout });
  return {
    window, document, worker, registration, windowHandlers, workerHandlers, posts, port,
    get reloads() { return reloads; }, get notice() { return pageChildren[0]; },
    setPlayback(value) { playback = value; },
    async load() { windowHandlers.load?.(); await new Promise(setImmediate); },
    async click() { return this.notice.children.find(child => child.tagName === "button").click(); },
    reply(ok) { worker.responsePort.onmessage({ data: { ok } }); },
    activate() { worker.state = "activated"; for (const handler of workerHandlers.statechange || []) handler(); }
  };
}

async function main() {
  await testWorkerActivationMessage();
  const page = createPage();
  await page.load();
  assert.equal(page.notice.attrs.role, "status");
  assert.equal(page.notice.attrs["aria-live"], "polite");
  assert.equal(page.notice.children[1].textContent, "Atualizar agora");
  assert.equal(page.posts.length, 0, "no worker message or activation occurs before the user's click");
  assert.equal(page.reloads, 0);
  await page.click();
  await page.click();
  assert.equal(page.posts.length, 1, "duplicate clicks send only one activation request");
  assert.equal(page.reloads, 0, "the initiating page waits for confirmation");
  page.reply(true);
  assert.equal(page.reloads, 0, "acknowledgement alone does not reload before activation");
  page.activate();
  assert.equal(page.reloads, 1, "the initiating tab reloads only after the worker is active");
  assert.equal(page.window.location.href, "https://example.test/tech-topics/article.html?slug=bulkhead#limits");

  const voice = createPage();
  await voice.load();
  voice.window.speechSynthesis.speaking = true;
  await voice.click();
  assert.equal(voice.posts.length, 0, "device voice blocks updating this tab until it stops");
  voice.window.speechSynthesis.speaking = false;
  voice.setPlayback(true);
  await voice.click();
  assert.equal(voice.posts.length, 0, "recorded playback blocks updating this tab until it stops");
  voice.setPlayback(false);
  await voice.click();
  assert.equal(voice.posts.length, 1);
  voice.reply(false);
  assert.match(voice.notice.children[2].textContent, /Não foi possível ativar/);
  assert.equal(voice.notice.children[1].disabled, false, "worker errors let the user retry");
  assert.equal(voice.reloads, 0);

  const playbackRace = createPage();
  await playbackRace.load();
  await playbackRace.click();
  assert.equal(playbackRace.posts.length, 1, "the initial click requests activation");
  playbackRace.reply(true);
  playbackRace.setPlayback(true);
  playbackRace.activate();
  assert.equal(playbackRace.reloads, 0, "media that starts before the reload is never interrupted");
  assert.equal(playbackRace.notice.children[1].textContent, "Aplicar atualização");
  assert.match(playbackRace.notice.children[2].textContent, /Quando a leitura ou reprodução terminar/);
  assert.match(playbackRace.notice.children[2].textContent, /clique em “Aplicar atualização” nesta aba/);
  playbackRace.setPlayback(false);
  await playbackRace.click();
  assert.equal(playbackRace.reloads, 1, "a second explicit click reloads once after media has ended");

  const firstInstall = createPage({ waiting: false, controlled: false });
  await firstInstall.load();
  assert.equal(firstInstall.notice, undefined, "first install has no update prompt");
  const unsupported = createPage({ supported: false });
  await unsupported.load();
  assert.equal(unsupported.notice, undefined, "unsupported browsers get no broken update UI");
  const missingChannel = createPage({ messageChannel: false });
  await missingChannel.load();
  await missingChannel.click();
  assert.equal(missingChannel.posts.length, 0, "missing MessageChannel never sends an unacknowledged activation request");
  assert.match(missingChannel.notice.children[2].textContent, /Não foi possível iniciar/);
  console.log("PASS: explicit PWA update action, active voice/audio guard, acknowledgement/state ordering, retries, first install and unsupported APIs.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
