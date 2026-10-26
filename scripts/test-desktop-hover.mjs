import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, mkdirSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TECH_TOPICS_PLAYWRIGHT);
const root = process.cwd();
const qaDir = process.env.TECH_TOPICS_QA_DIR;
if (qaDir) mkdirSync(qaDir, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const file = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://local').pathname)));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    if (!statSync(file).isFile()) throw new Error('not a file');
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    createReadStream(file).pipe(res);
  } catch { res.writeHead(404).end(); }
});

async function testTouchBehavior(browser, base) {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.route('**/api.github.com/**', route => route.abort());
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    const card = page.locator('.recent-item').filter({ hasText: 'Rate Limiting: Token Bucket, Leaky Bucket e limites sob rajadas' });
    await card.waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches), true);
    const cardBox = await card.boundingBox();
    assert.ok(cardBox, 'touch card has no geometry');
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.waitForTimeout(220);
    assert.equal(await page.locator('#article-quick-actions').isVisible(), false, 'coarse pointers must not open by mouse hover');

    let touchScreenshotSaved = false;
    const startHold = async targetCard => {
      const inputPage = targetCard.page();
      const handle = await targetCard.elementHandle();
      await inputPage.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }), handle);
      await inputPage.waitForTimeout(100);
      const box = await targetCard.boundingBox();
      const x = Math.round(box.x + Math.min(60, box.width / 3));
      const y = Math.round(box.y + Math.min(60, box.height / 3));
      const targetAtPoint = await inputPage.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.recent-item')?.className || null, { x, y });
      assert.equal(targetAtPoint, 'recent-item', 'touch start must land on the article card');
      const cdp = await context.newCDPSession(inputPage);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await inputPage.waitForTimeout(560);
      const popup = inputPage.locator('#article-quick-actions');
      assert.ok(await popup.isVisible(), `touch long-press must still open quick actions at ${x},${y}`);
      assert.match(await popup.locator('.quick-hint').innerText(), /^(Arraste|Solte)/, 'touch gesture must retain drag-and-release guidance');
      if (qaDir && !touchScreenshotSaved) {
        await inputPage.screenshot({ path: join(qaDir, 'touch-longpress.png'), fullPage: false });
        touchScreenshotSaved = true;
      }
      return { cdp, popup, page: inputPage, x, y };
    };
    const releaseOn = async (hold, action) => {
      const bounds = await hold.page.locator(`[data-quick-action="${action}"]`).boundingBox();
      assert.ok(bounds, `missing touch action ${action}`);
      const targetX = Math.round(bounds.x + bounds.width / 2);
      const targetY = Math.round(bounds.y + bounds.height / 2);
      for (let step = 1; step <= 8; step++) {
        await hold.cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: Math.round(hold.x + (targetX - hold.x) * step / 8), y: Math.round(hold.y + (targetY - hold.y) * step / 8) }],
        });
        await hold.page.waitForTimeout(18);
      }
      await hold.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };

    let hold = await startHold(card);
    await releaseOn(hold, 'read');
    await page.waitForURL('**/article.html?slug=rate-limiting-token-bucket-leaky-bucket');
    await page.close();

    const favoritePage = await context.newPage();
    await favoritePage.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    const favoriteCard = favoritePage.locator('.recent-item').filter({ hasText: 'Rate Limiting: Token Bucket, Leaky Bucket e limites sob rajadas' });
    await favoriteCard.waitFor({ state: 'visible', timeout: 20000 });
    hold = await startHold(favoriteCard);
    await releaseOn(hold, 'favorite');
    assert.deepEqual(await favoritePage.evaluate(() => JSON.parse(localStorage.getItem('tech-topics:favorites:v1') || '[]')),
      ['rate-limiting-token-bucket-leaky-bucket'], 'touch drag-release on favorite must toggle the correct article');
    await favoritePage.close();

    const scrollPage = await context.newPage();
    await scrollPage.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    const scrollCard = scrollPage.locator('.recent-item').first();
    await scrollCard.waitFor({ state: 'visible', timeout: 20000 });
    const scrollBox = await scrollCard.boundingBox();
    const cdp = await context.newCDPSession(scrollPage);
    const sx = Math.round(scrollBox.x + scrollBox.width / 2);
    const sy = Math.round(scrollBox.y + scrollBox.height / 2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy - 100 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await scrollPage.waitForTimeout(250);
    assert.equal(await scrollPage.locator('#article-quick-actions').isVisible(), false, 'movement before the hold threshold must not open quick actions');
    assert.ok(await scrollPage.evaluate(() => window.scrollY > 0), 'touch movement before the hold threshold must scroll the page');
    console.log('PASS: coarse-pointer hover stays closed; touch long-press can read/favorite; short drag scrolls normally');
  } finally {
    await context.close();
  }
}

async function assertCardHover(page, card, label) {
  await card.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(60);
  const title = await card.locator('.recent-copy h3 a').innerText();
  const before = await page.evaluate(() => window.__pointerDownCount);
  const bounds = await card.boundingBox();
  assert.ok(bounds, `${label} card has no geometry`);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const popup = page.locator('#article-quick-actions');
  await popup.waitFor({ state: 'visible', timeout: 3000 });
  assert.equal(await page.locator('#quick-preview-title').innerText(), title, `${label} hover must show the corresponding card`);
  assert.equal(await page.evaluate(() => window.__pointerDownCount), before, `${label} hover must not require a press`);
}

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.TECH_TOPICS_CHROMIUM });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => {
    window.__pointerDownCount = 0;
    document.addEventListener('pointerdown', () => window.__pointerDownCount++, true);
  });
  await page.route('**/api.github.com/**', route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
  const card = page.locator('.recent-item').filter({ hasText: 'Rate Limiting: Token Bucket, Leaky Bucket e limites sob rajadas' });
  await card.waitFor({ state: 'visible', timeout: 20000 });
  assert.equal(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches), true);
  const bounds = await card.boundingBox();
  assert.ok(bounds, 'Rate Limiting card has no geometry');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  assert.equal(await card.evaluate(el => el.matches(':hover')), true, 'real mouse must reach the article card');
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.recent-item')?.querySelector('h3 a')?.textContent,
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }),
    'Rate Limiting: Token Bucket, Leaky Bucket e limites sob rajadas', 'card must be the hit-tested target');
  const popup = page.locator('#article-quick-actions');
  await popup.waitFor({ state: 'visible', timeout: 3000 });
  assert.equal(await popup.getAttribute('role'), 'dialog');
  assert.equal(await popup.getAttribute('aria-labelledby'), 'quick-preview-title');
  assert.equal(await page.locator('#quick-preview-title').innerText(), 'Rate Limiting: Token Bucket, Leaky Bucket e limites sob rajadas');
  assert.equal(await page.evaluate(() => window.__pointerDownCount), 0, 'hover must open quick actions without pressing');
  const hoverHint = 'Clique em uma ação; afaste o cursor para fechar.';
  assert.equal(await popup.locator('.quick-hint').innerText(), hoverHint, 'hover dialog must explain click and cursor-leave behavior');
  if (qaDir) await page.screenshot({ path: join(qaDir, 'desktop-hover-no-pointerdown.png'), fullPage: false });
  const read = page.locator('#article-quick-actions [data-quick-action="read"]');
  await read.hover();
  await page.waitForTimeout(220);
  assert.equal(await popup.isVisible(), true, 'moving from the card into the popover must keep it open');
  assert.equal(await popup.locator('.quick-hint').innerText(), hoverHint, 'hover action movement must not restore touch drag guidance');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.waitForTimeout(220);
  assert.equal(await popup.isVisible(), true, 'returning to the card must keep the popover open');
  assert.equal(await popup.locator('.quick-hint').innerText(), hoverHint, 'reopening/highlight must retain hover guidance');
  await read.hover();
  await read.click();
  await page.waitForURL('**/article.html?slug=rate-limiting-token-bucket-leaky-bucket');
  console.log('PASS: fine-pointer hover opens the matching named quick-actions dialog without pointerdown; read action navigates');

  const directPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await directPage.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
  const directCard = directPage.locator('.recent-item').filter({ hasText: 'Rate Limiting: Token Bucket, Leaky Bucket e limites sob rajadas' });
  await directCard.waitFor({ state: 'visible', timeout: 20000 });
  const titleLink = directCard.locator('.recent-copy h3 a');
  await titleLink.scrollIntoViewIfNeeded();
  const directBox = await directCard.boundingBox();
  await directPage.mouse.move(directBox.x + directBox.width / 2, directBox.y + directBox.height / 2);
  const directPopup = directPage.locator('#article-quick-actions');
  await directPopup.waitFor({ state: 'visible', timeout: 3000 });
  const titleBounds = await titleLink.boundingBox();
  await directPage.mouse.move(titleBounds.x + titleBounds.width / 2, titleBounds.y + titleBounds.height / 2);
  await directPage.waitForTimeout(220);
  assert.equal(await directPopup.isVisible(), true, 'moving within the card must not close its popover');
  const titleHit = await directPage.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('a')?.textContent,
    { x: titleBounds.x + titleBounds.width / 2, y: titleBounds.y + titleBounds.height / 2 });
  assert.equal(titleHit, 'Rate Limiting: Token Bucket, Leaky Bucket e limites sob rajadas', 'hover popover must not cover the normal title link');
  await directPage.mouse.click(titleBounds.x + titleBounds.width / 2, titleBounds.y + titleBounds.height / 2);
  await directPage.waitForURL('**/article.html?slug=rate-limiting-token-bucket-leaky-bucket');
  await directPage.close();
  console.log('PASS: normal title click still navigates after hover opens the popover');

  const closePage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await closePage.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
  const closeCard = closePage.locator('.recent-item').filter({ hasText: 'Rate Limiting: Token Bucket, Leaky Bucket e limites sob rajadas' });
  await closeCard.waitFor({ state: 'visible', timeout: 20000 });
  const closeBox = await closeCard.boundingBox();
  const closePopup = closePage.locator('#article-quick-actions');
  await closePage.mouse.move(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2);
  await closePopup.waitFor({ state: 'visible', timeout: 3000 });
  await closePage.mouse.move(5, 5);
  await closePage.waitForTimeout(240);
  assert.equal(await closePopup.isVisible(), false, 'leaving both card and popover must close the menu');
  await closeCard.focus();
  await closePage.keyboard.press('Enter');
  assert.equal(await closePopup.isVisible(), true, 'keyboard Enter must keep opening quick actions');
  assert.equal(await closePopup.locator('.quick-hint').innerText(), 'Use Tab para escolher uma ação, Enter para ativar e Escape para fechar.',
    'keyboard dialog must explain keyboard navigation');
  await closePage.keyboard.press('Escape');
  assert.equal(await closePopup.isVisible(), false, 'Escape must close keyboard quick actions');
  console.log('PASS: pointer leave closes the hover menu; Enter and Escape remain accessible');
  await closePage.close();

  const dynamicPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await dynamicPage.addInitScript(() => {
    window.__pointerDownCount = 0;
    document.addEventListener('pointerdown', () => window.__pointerDownCount++, true);
  });
  await dynamicPage.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
  await dynamicPage.locator('#load-more').click();
  const laterCard = dynamicPage.locator('.recent-item').nth(6);
  await laterCard.waitFor({ state: 'visible', timeout: 20000 });
  await assertCardHover(dynamicPage, laterCard, 'card added by load more');
  await dynamicPage.mouse.move(5, 5);
  await dynamicPage.waitForTimeout(220);
  await dynamicPage.locator('#search-input').fill('Rate Limiting');
  const searchedCard = dynamicPage.locator('.recent-item').filter({ hasText: 'Rate Limiting: Token Bucket, Leaky Bucket e limites sob rajadas' });
  await searchedCard.waitFor({ state: 'visible', timeout: 20000 });
  await assertCardHover(dynamicPage, searchedCard, 'search result');
  console.log('PASS: hover works on cards rendered by load more and search, without a press');
  await dynamicPage.close();
  await testTouchBehavior(browser, `http://127.0.0.1:${server.address().port}`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
