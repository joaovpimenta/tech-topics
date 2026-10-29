"""Real Chromium geometry + touch-input regression; run with Playwright installed."""
from __future__ import annotations

import functools
import os
import shutil
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(os.environ.get("TECH_TOPICS_UI_ROOT", Path(__file__).resolve().parent.parent / "dist"))


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def test_responsive_archive(browser, base):
    page = browser.new_page(viewport={"width": 1280, "height": 900}, reduced_motion="reduce")
    page.add_init_script("delete window.IntersectionObserver; Object.defineProperty(navigator, 'share', {value: async data => { window.__shared = data; }});")
    page.route("**/api.github.com/**", lambda route: route.abort())
    try:
        page.goto(base + "/index.html", wait_until="domcontentloaded")
        page.locator(".recent-item").first.wait_for(state="visible", timeout=20000)
        for width in (320, 360, 390, 480, 600, 719, 720, 721, 760, 850, 900, 1024, 1280, 1440, 1600, 1920):
            page.set_viewport_size({"width": width, "height": 900})
            data = page.evaluate("""() => {
              const rect = e => { const r = e.getBoundingClientRect(); return {left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width}; };
              const header = [...document.querySelectorAll('.home-header-inner .brand, .top-search, .github-stars')].map(rect);
              const cards = [...document.querySelectorAll('#recent-list .recent-item')].map(rect);
              return {overflow:document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, header, cards,
                columns:getComputedStyle(document.querySelector('#recent-list')).gridTemplateColumns};
            }""")
            assert not data["overflow"], (width, "document overflow")
            assert all(r["left"] >= -1 and r["right"] <= width + 1 for r in data["header"]), (width, "header outside viewport", data)
            assert all(a["right"] <= b["left"] + 1 for a, b in zip(data["header"], data["header"][1:])), (width, "header overlap", data)
            cards = data["cards"]
            assert all(r["left"] >= -1 and r["right"] <= width + 1 for r in cards), (width, "card outside viewport", data)
            if width <= 720:
                assert cards[1]["top"] >= cards[0]["bottom"] - 1, (width, "mobile list", data)
            else:
                assert all(r["width"] >= 280 for r in cards), (width, "card too narrow", data)
                assert cards[1]["top"] == cards[0]["top"], (width, "desktop grid", data)
            if width >= 1280:
                assert cards[2]["top"] == cards[0]["top"], (width, "three columns fit", data)
            if width in (390, 900, 1440) and os.environ.get('TECH_TOPICS_UI_SCREENSHOTS'):
                directory = Path(os.environ['TECH_TOPICS_UI_SCREENSHOTS'])
                directory.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(directory / f'archive-{width}.png'))
        search = page.locator('#search-input')
        search.fill('transactional outbox')
        assert page.locator('.recent-item').count() > 0
        assert ' de ' in page.locator('#article-count').inner_text()
        search.fill('zzzz-no-article-matches')
        page.locator('#empty-state').wait_for(state='visible')
        search.fill('')
        page.locator('.recent-item').first.wait_for(state='visible')
        favorite = page.locator('.recent-item .favorite-button').first
        favorite.click()
        assert favorite.get_attribute('aria-pressed') == 'true'
        favorite.click()
        page.locator('.recent-item .card-actions button').nth(1).click()
        assert page.evaluate('window.__shared && window.__shared.url.includes("article.html?slug=")')
        load_more = page.locator('#load-more')
        if load_more.is_visible():
            before = page.locator('.recent-item').count()
            load_more.click()
            assert page.locator('.recent-item').count() > before
        # The popup must remain inside the viewport even on either grid edge.
        for card in (page.locator('.recent-item').first, page.locator('.recent-item').nth(2)):
            card.scroll_into_view_if_needed()
            card.focus()
            page.keyboard.press('Enter')
            popup = page.locator('#article-quick-actions')
            popup.wait_for(state='visible')
            bounds = popup.bounding_box()
            assert bounds and bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= 1921, bounds
            page.keyboard.press('Escape')
        page.set_viewport_size({'width': 1280, 'height': 900})
        page.evaluate("document.body.style.zoom = '2'")
        assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'), 'home 200% zoom overflow'
        assert page.locator('#search-input').is_visible() and page.locator('.favorite-button').first.is_visible()
        print('PASS: responsive archive and topbar across 320–1920px, search, loading, favorites and keyboard preview')
    finally:
        page.close()


def test_archive_extremes(browser, base):
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    page.add_init_script("""(() => {
      const original = window.fetch;
      let release;
      window.__releaseCatalog = () => release();
      const waiting = new Promise(resolve => { release = resolve; });
      window.fetch = async (...args) => {
        const response = await original(...args);
        if (!String(args[0]).includes('articles-catalog.json')) return response;
        await waiting;
        const catalog = await response.json();
        catalog.articles[0].title = 'Título longo '.repeat(20);
        catalog.articles[0].excerpt = ''; catalog.articles[0].dek = '';
        catalog.articles[0].image = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="400"></svg>';
        catalog.articles[1].image = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"></svg>';
        return new Response(JSON.stringify(catalog), {status: 200, headers: {'Content-Type':'application/json'}});
      };
    })();""")
    try:
        page.goto(base + '/index.html', wait_until='domcontentloaded')
        assert page.locator('#recent-list').get_attribute('aria-busy') == 'true'
        assert 'Carregando' in page.locator('#article-count').inner_text()
        page.evaluate('window.__releaseCatalog()')
        page.locator('.recent-item').first.wait_for(state='visible')
        assert page.locator('#recent-list').get_attribute('aria-busy') == 'false'
        assert page.locator('.recent-item h3').first.inner_text() == 'Título longo ' * 19 + 'Título longo'
        assert page.locator('.recent-item .excerpt').first.inner_text() == ''
        for card in page.locator('.recent-item').all()[:2]:
            values = card.evaluate("""e => {
              const image = e.querySelector('img'), text = e.querySelector('.recent-copy'), actions = e.querySelector('.card-actions');
              return {fit:getComputedStyle(image).objectFit, image:image.getBoundingClientRect().toJSON(),
                text:text.getBoundingClientRect().toJSON(), actions:actions.getBoundingClientRect().toJSON(),
                overflow:e.scrollWidth > e.clientWidth + 1};
            }""")
            assert values['fit'] == 'contain' and not values['overflow'], values
            assert values['actions']['top'] >= values['image']['bottom'], values
        print('PASS: loading state, long title, missing excerpt and portrait/wide covers')
    finally:
        page.close()


def test_responsive_article_header(browser, base):
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.route("**/api.github.com/**", lambda route: route.abort())
    try:
        page.goto(base + '/article.html?slug=transactional-outbox', wait_until='domcontentloaded')
        page.locator('#article-actions').wait_for(state='visible', timeout=20000)
        for width in (320, 390, 600, 720, 721, 900, 1280, 1920):
            page.set_viewport_size({'width': width, 'height': 900})
            result = page.evaluate("""() => {
              const boxes = [...document.querySelectorAll('.home-header-inner .brand, .top-search, .github-stars')].map(e => {
                const r = e.getBoundingClientRect(); return {left:r.left, right:r.right};
              });
              return {boxes, overflow:document.documentElement.scrollWidth > document.documentElement.clientWidth + 1};
            }""")
            assert not result['overflow'], (width, result)
            assert all(a['right'] <= b['left'] + 1 for a, b in zip(result['boxes'], result['boxes'][1:])), (width, result)
        page.set_viewport_size({'width': 1280, 'height': 900})
        page.evaluate("document.body.style.zoom = '2'")
        assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'), '200% zoom overflow'
        print('PASS: article header geometry across 320–1920px and 200% zoom')
    finally:
        page.close()


def test_diagrams_fit_viewport(browser, base):
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    page.route('**/*', lambda route: route.continue_()
               if route.request.url.startswith(base + '/') else route.abort())
    try:
        page.goto(base + '/article.html?slug=transactional-outbox', wait_until='domcontentloaded')
        page.locator('#article-actions').wait_for(state='visible', timeout=20000)
        page.locator('.mermaid-error').first.wait_for(state='visible')
        # Rendered SVG is the CSS boundary: cover Mermaid's flowchart and chart
        # dimensions without depending on the availability of its external CDN.
        page.locator('.mermaid-diagram').evaluate_all('''containers => {
          containers.forEach((container, index) => {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', index % 2 ? '0 0 700 500' : '-8 -8 1400 500');
            svg.setAttribute('width', '100%');
            svg.style.maxWidth = index % 2 ? '700px' : '1400px';
            svg.setAttribute('role', 'img');
            const rect = document.createElementNS(svg.namespaceURI, 'rect');
            rect.setAttribute('width', '600'); rect.setAttribute('height', '400');
            svg.append(rect);
            container.classList.remove('mermaid-error');
            container.replaceChildren(svg);
          });
        }''')
        for width in (320, 360, 390, 430, 720, 1280):
            page.set_viewport_size({'width': width, 'height': 844})
            measured = page.locator('.mermaid-diagram').evaluate_all('''containers => containers.map(container => {
              const svg = container.querySelector('svg');
              const box = container.getBoundingClientRect(), diagram = svg.getBoundingClientRect();
              return {left:box.left, right:box.right, width:box.width,
                diagramLeft:diagram.left, diagramRight:diagram.right, diagramWidth:diagram.width,
                scrollWidth:container.scrollWidth, clientWidth:container.clientWidth,
                height:diagram.height, ratio:svg.viewBox.baseVal.width / svg.viewBox.baseVal.height};
            })''')
            assert measured, 'article has no rendered diagram fixtures'
            for diagram in measured:
                assert diagram['left'] >= 0 and diagram['right'] <= width + 1, (width, diagram)
                assert diagram['diagramLeft'] >= diagram['left'] and diagram['diagramRight'] <= diagram['right'] + 1, ('diagram cut off', width, diagram)
                assert diagram['scrollWidth'] <= diagram['clientWidth'] + 1, ('diagram requires horizontal scrolling', width, diagram)
                assert abs(diagram['diagramWidth'] / diagram['height'] - diagram['ratio']) < .02, ('distorted diagram', width, diagram)
        print('PASS: rendered flowcharts and charts fit 320–1280px without clipping, scrolling or distortion')
    finally:
        page.close()


def test_player(browser, base):
    page = browser.new_page(viewport={"width": 430, "height": 800})
    page.route("**/api.github.com/**", lambda route: route.abort())
    try:
        page.goto(base + "/article.html?slug=transactional-outbox", wait_until="domcontentloaded")
        page.locator("#article-actions").wait_for(state="visible", timeout=20000)
        for width in (280, 320, 360, 375, 390, 400, 414, 430, 520, 620, 720, 900, 1280, 1920):
            page.set_viewport_size({"width": width, "height": 800})
            page.locator("#article-actions").scroll_into_view_if_needed()
            page.evaluate("""() => {
              for (const id of ['inline-recording-previous', 'inline-recording-next']) {
                const button = document.getElementById(id);
                button.hidden = false;
                button.disabled = false;
              }
              document.getElementById('inline-recording-rate').textContent = '1.25×';
              document.getElementById('inline-recording-duration').textContent = '12:34:56';
              window.dispatchEvent(new Event('resize'));
            }""")
            page.wait_for_timeout(90)
            measured = page.evaluate("""() => {
              const byId = id => document.getElementById(id);
              const box = id => {
                const r = byId(id).getBoundingClientRect();
                return {left:r.left, right:r.right, width:r.width, top:r.top, bottom:r.bottom};
              };
              return {
                player:box('inline-recording-anchor'),
                play:box('listen-recording'),
                previous:box('inline-recording-previous'),
                next:box('inline-recording-next'),
                rate:box('inline-recording-rate'),
                favorite:box('favorite-article'),
                share:box('share-article'),
                seek:box('inline-recording-seek'),
                timelineHidden:byId('inline-recording-timeline').hidden
              };
            }""")
            fixed = [measured[name] for name in ("play", "previous", "next", "rate", "favorite", "share")]
            assert all(rect["width"] >= 18 for rect in fixed), (width, "missing controls", measured)
            assert all(a["right"] <= b["left"] + 0.5 for a, b in zip(fixed, fixed[1:])), (width, "overlapping controls", measured)
            assert measured["rate"]["right"] + 1 <= measured["favorite"]["left"], (width, "speed under favorite", measured)
            assert measured["rate"]["right"] <= measured["player"]["right"] + 1, (width, "rate overflows player", measured)
            if measured["timelineHidden"]:
                assert measured["seek"]["width"] == 0, (width, "timeline must fully disappear", measured)
            else:
                assert measured["seek"]["width"] >= 30, (width, "timeline visible but unusable", measured)
        print("PASS: Chromium player geometry at 280–1920px, chapter buttons and 1.25× speed")
    finally:
        page.close()


def test_press_drag(browser, base):
    page = browser.new_page(viewport={"width": 390, "height": 800}, has_touch=True, is_mobile=True)
    page.add_init_script("""(() => {
      window.__vibrations = [];
      Object.defineProperty(navigator, 'vibrate', {
        configurable: true, value: milliseconds => {
          window.__vibrations.push(milliseconds);
          return true;
        }
      });
    })()""")
    try:
        page.goto(base + "/index.html", wait_until="domcontentloaded")
        card = page.locator(".recent-item").first
        card.wait_for(state="visible", timeout=20000)
        card.scroll_into_view_if_needed()
        rect = card.locator(".recent-image").bounding_box()
        assert rect, "home card has no geometry"
        x = round(rect["x"] + min(55, rect["width"] / 3))
        y = round(rect["y"] + min(55, rect["height"] / 3))
        cdp = page.context.new_cdp_session(page)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        page.wait_for_timeout(620)
        popup = page.locator("#article-quick-actions")
        assert popup.is_visible(), "press-and-hold must open preview"

        def move_to(target_x, target_y):
            nonlocal x, y
            for step in range(1, 11):
                px = round(x + (target_x - x) * step / 10)
                py = round(y + (target_y - y) * step / 10)
                cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": px, "y": py}]})
                page.wait_for_timeout(18)
            x, y = target_x, target_y

        assert popup.get_attribute("data-gesture-active") is not None, "held gesture disables sticky CSS hover"
        # Move forward, backward, and through actions already hovered. A
        # previous action must lose not just its class but its *rendered* halo.
        sequence = ("read", "favorite", "share", "favorite", "read", "share")
        for action in sequence:
            target = page.locator('[data-quick-action="' + action + '"]')
            bounds = target.bounding_box()
            assert bounds and bounds["height"] >= 40, ("missing target", action)
            move_to(round(bounds["x"] + bounds["width"] / 2), round(bounds["y"] + bounds["height"] / 2))
            page.wait_for_timeout(200)  # allow transition to settle
            assert popup.get_attribute("data-active-action") == action, ("stuck action state", action)
            active = page.locator("#article-quick-actions .is-targeted")
            assert active.count() == 1, ("more than one highlighted action", action)
            assert active.first.get_attribute("data-quick-action") == action, ("stale highlight class", action)
            for candidate in ("read", "favorite", "share"):
                element = page.locator('[data-quick-action="' + candidate + '"]')
                computed = element.evaluate("""(el) => ({
                  shadow: getComputedStyle(el).boxShadow,
                  background: getComputedStyle(el).backgroundColor
                })""")
                if candidate != action:
                    assert computed["shadow"] == "none", (
                        "previous button retains visual glow after finger leaves", action, candidate, computed)
                else:
                    assert computed["shadow"] != "none", ("active button has no visual halo", action, computed)
            pulses_before = len(page.evaluate("window.__vibrations"))
            cdp.send("Input.dispatchTouchEvent", {
                "type": "touchMove", "touchPoints": [{"x": x, "y": y}]
            })
            page.wait_for_timeout(40)
            assert len(page.evaluate("window.__vibrations")) == pulses_before, (
                "stationary touch retriggers vibration", action)
        pulses = page.evaluate("window.__vibrations")
        assert len(pulses) >= 6 and all(pulse == 12 for pulse in pulses), ("missing transition haptics", pulses)
        move_to(2, 2)
        page.wait_for_timeout(200)
        assert popup.get_attribute("data-active-action") == "", "leaving controls must clear active action"
        assert page.locator("#article-quick-actions .is-targeted").count() == 0, (
            "visual highlight must clear when finger leaves all buttons")
        for candidate in ("read", "favorite", "share"):
            shadow = page.locator('[data-quick-action="' + candidate + '"]').evaluate(
                "(el) => getComputedStyle(el).boxShadow")
            assert shadow == "none", ("stuck CSS hover after leaving popup", candidate, shadow)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        assert not popup.is_visible(), "release outside must close preview"
        assert page.evaluate("localStorage.getItem('tech-topics:favorites:v1')") in (None, "[]"), "release outside must not favorite"
        print("PASS: Chromium touch drag switches read/favorite/share in both directions, clearing stale halos")
    finally:
        page.close()


def test_touch_buttons_do_not_keep_hover(browser, base):
    page = browser.new_page(viewport={"width": 390, "height": 800}, has_touch=True, is_mobile=True)

    def wait_for_background(selector, color):
        page.wait_for_function(
            "args => { const el = document.querySelector(args.selector); "
            "return el && getComputedStyle(el).backgroundColor === args.color; }",
            arg={"selector": selector, "color": color},
        )

    try:
        page.goto(base + "/index.html", wait_until="domcontentloaded")
        favorite = page.locator(".recent-item .favorite-button").first
        favorite.wait_for(state="visible", timeout=20000)
        favorite.scroll_into_view_if_needed()
        assert page.evaluate("matchMedia('(hover: hover) and (pointer: fine)').matches") is False
        favorite.tap()
        assert favorite.get_attribute("aria-pressed") == "true"
        wait_for_background(".recent-item .favorite-button", "rgb(237, 245, 241)")
        favorited_color = favorite.evaluate("el => getComputedStyle(el).backgroundColor")
        assert favorited_color == "rgb(237, 245, 241)", ("favorite state must remain visible", favorited_color)
        favorite.tap()
        assert favorite.get_attribute("aria-pressed") == "false"
        wait_for_background(".recent-item .favorite-button", "rgb(255, 255, 255)")
        card_color = favorite.evaluate("el => getComputedStyle(el).backgroundColor")
        assert card_color == "rgb(255, 255, 255)", ("touch must not leave card hover styling", card_color)

        title_link = page.locator(".recent-item .recent-copy h3 a").first
        title_link.tap()
        page.wait_for_url("**/article.html?slug=*")
        article_favorite = page.locator("#favorite-article")
        article_favorite.wait_for(state="visible", timeout=20000)
        article_share = page.locator("#share-article")
        for action in (article_favorite, article_share):
            action_color_after_navigation = action.evaluate("el => getComputedStyle(el).backgroundColor")
            assert action_color_after_navigation == "rgb(255, 255, 255)", (
                "opening an article by touch must not leave action hover styling",
                action.get_attribute("id"), action_color_after_navigation)
        article_favorite.tap()
        assert article_favorite.get_attribute("aria-pressed") == "true"
        wait_for_background("#favorite-article", "rgb(237, 245, 241)")
        article_favorite.tap()
        assert article_favorite.get_attribute("aria-pressed") == "false"
        wait_for_background("#favorite-article", "rgb(255, 255, 255)")
        action_color = article_favorite.evaluate("el => getComputedStyle(el).backgroundColor")
        assert action_color == "rgb(255, 255, 255)", ("touch must not leave article action hover styling", action_color)
        print("PASS: touch favorite state persists only while favorited; card and article action hover clears")
    finally:
        page.close()


if __name__ == "__main__":
    if not (ROOT / "article.html").is_file():
        raise SystemExit("Build the production artifact in dist/ before running the UI browser test.")
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            system_chromium = shutil.which("chromium")
            browser = playwright.chromium.launch(headless=True, executable_path=system_chromium)
            try:
                base = f"http://127.0.0.1:{server.server_port}"
                test_responsive_archive(browser, base)
                test_archive_extremes(browser, base)
                test_responsive_article_header(browser, base)
                test_diagrams_fit_viewport(browser, base)
                test_player(browser, base)
                test_touch_buttons_do_not_keep_hover(browser, base)
                test_press_drag(browser, base)
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
