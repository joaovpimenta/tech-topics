"""Real Chromium geometry + touch-input regression; run with Playwright installed."""
from __future__ import annotations

import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def test_player(browser, base):
    page = browser.new_page(viewport={"width": 430, "height": 800})
    page.route("**/api.github.com/**", lambda route: route.abort())
    try:
        page.goto(base + "/article.html?slug=transactional-outbox", wait_until="domcontentloaded")
        page.locator("#article-actions").wait_for(state="visible", timeout=20000)
        for width in (280, 320, 360, 375, 390, 400, 414, 430, 520, 620, 720):
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
        print("PASS: Chromium player geometry at 280–720px, chapter buttons and 1.25× speed")
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


if __name__ == "__main__":
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                base = f"http://127.0.0.1:{server.server_port}"
                test_player(browser, base)
                test_press_drag(browser, base)
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
