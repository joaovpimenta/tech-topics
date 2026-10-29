"""Exercise recommendation navigation and layout against the built site."""
import functools
import os
import shutil
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright

root = Path(os.environ.get('TECH_TOPICS_UI_ROOT', Path(__file__).resolve().parent.parent / 'dist'))

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(root)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=shutil.which('chromium'))
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 900}, reduced_motion='reduce')
            requests = []
            page.on('request', lambda request: requests.append(request.url))
            page.goto(f'http://127.0.0.1:{server.server_port}/article.html?slug=transactional-outbox')
            page.locator('#recommendations').wait_for(state='visible', timeout=20000)
            cards = page.locator('#recommendations-list .recent-item')
            def slugs():
                return [parse_qs(urlparse(href).query)['slug'][0] for href in cards.locator('.recent-image').evaluate_all('(els) => els.map(e => e.href)')]
            selected = slugs()
            assert len(selected) == len(set(selected)) == 3 and 'transactional-outbox' not in selected, selected
            for width in (320, 600, 900, 1280):
                page.set_viewport_size({'width': width, 'height': 900})
                assert slugs() == selected, 'resize changed selection'
                boxes = [cards.nth(i).bounding_box() for i in range(3)]
                assert all(box and box['x'] >= 0 and box['x'] + box['width'] <= width + 1 for box in boxes), boxes
                assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1')
                if width <= 600:
                    assert boxes[1]['y'] >= boxes[0]['y'] + boxes[0]['height'] - 1, boxes
            assert cards.locator('img[alt][loading="lazy"]').count() == 3
            cards.first.scroll_into_view_if_needed()
            cards.first.focus()
            page.keyboard.press('Enter')
            page.locator('#article-quick-actions').wait_for(state='visible')
            page.keyboard.press('Escape')
            assert page.locator('#article-quick-actions').is_hidden()
            page.set_viewport_size({'width': 1280, 'height': 900})
            boxes = [cards.nth(i).bounding_box() for i in range(3)]
            assert max(box['y'] for box in boxes) - min(box['y'] for box in boxes) < 1, boxes
            assert len([url for url in requests if '/assets/articles-catalog.json' in url]) == 1
            assert len([url for url in requests if '/content/articles/' in url and url.endswith('.html')]) == 1
            main_favorite = page.locator('#favorite-article')
            main_favorite.click()
            cards.first.locator('.favorite-button').click()
            stored = page.evaluate('JSON.parse(localStorage.getItem("tech-topics:favorites:v1"))')
            assert set(stored) == {'transactional-outbox', selected[0]}, ('favorite overwritten', stored)
            main_favorite.click()
            stored = page.evaluate('JSON.parse(localStorage.getItem("tech-topics:favorites:v1"))')
            assert stored == [selected[0]], ('article overwrote recommendation favorite', stored)
            cards.first.locator('.favorite-button').click()
            cards.first.locator('.recent-image').click()
            page.wait_for_url('**/article.html?slug=*')
            page.locator('#recommendations').wait_for(state='visible')
            assert selected[0] not in slugs()
            touch = browser.new_page(viewport={'width': 390, 'height': 800}, has_touch=True, is_mobile=True, reduced_motion='reduce')
            touch.add_init_script("""Object.defineProperty(navigator, 'share', {configurable: true,
                value: async data => { window.__shared = data; }});""")
            touch.goto(f'http://127.0.0.1:{server.server_port}/article.html?slug=transactional-outbox')
            touch.locator('#recommendations').wait_for(state='visible', timeout=20000)
            card = touch.locator('#recommendations-list .recent-item').first
            touch.evaluate('document.fonts.ready')
            card.locator('.recent-image').evaluate("image => image.scrollIntoView({block: 'center', behavior: 'instant'})")
            card.locator('img').evaluate('(image) => image.decode().catch(() => {})')
            cdp = touch.context.new_cdp_session(touch)
            def hold_and_release(action):
                image = card.locator('.recent-image')
                image.evaluate("image => image.scrollIntoView({block: 'center', behavior: 'instant'})")
                box = image.bounding_box()
                x, y = round(box['x'] + box['width'] / 2), round(box['y'] + box['height'] / 2)
                assert card.evaluate('(card, point) => card.contains(document.elementFromPoint(point.x, point.y))', {'x': x, 'y': y}), ('touch target occluded', box)
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
                popup = touch.locator('#article-quick-actions')
                popup.wait_for(state='visible', timeout=3000)
                target = popup.locator('[data-quick-action="' + action + '"]').bounding_box()
                tx, ty = round(target['x'] + target['width'] / 2), round(target['y'] + target['height'] / 2)
                for step in range(1, 11):
                    px, py = round(x + (tx-x)*step/10), round(y + (ty-y)*step/10)
                    cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': px, 'y': py}]})
                    touch.wait_for_timeout(18)
                assert popup.get_attribute('data-active-action') == action
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            hold_and_release('favorite')
            assert card.locator('.favorite-button').get_attribute('aria-pressed') == 'true'
            touch.wait_for_timeout(400)
            hold_and_release('share')
            touch.wait_for_function('window.__shared && window.__shared.url')
            assert parse_qs(urlparse(touch.evaluate('window.__shared.url')).query)['slug'][0] != 'transactional-outbox'
            touch.close()
            unavailable_storage = browser.new_page()
            unavailable_storage.add_init_script("""Storage.prototype.getItem = () => { throw new Error('storage unavailable'); };
                Storage.prototype.setItem = () => { throw new Error('storage unavailable'); };""")
            unavailable_storage.goto(f'http://127.0.0.1:{server.server_port}/article.html?slug=transactional-outbox')
            unavailable_storage.locator('#recommendations').wait_for(state='visible', timeout=20000)
            fallback_card = unavailable_storage.locator('#recommendations-list .recent-item').first
            fallback_favorite = fallback_card.locator('.favorite-button')
            fallback_favorite.click()
            assert fallback_favorite.get_attribute('aria-pressed') == 'true'
            fallback_card.focus()
            unavailable_storage.keyboard.press('Enter')
            fallback_popup = unavailable_storage.locator('#article-quick-actions')
            fallback_popup.wait_for(state='visible')
            assert fallback_popup.locator('[data-quick-action="favorite"]').get_attribute('aria-pressed') == 'true'
            unavailable_storage.keyboard.press('Escape')
            fallback_favorite.click()
            assert fallback_favorite.get_attribute('aria-pressed') == 'false'
            unavailable_storage.close()
            full_storage = browser.new_page()
            full_storage.add_init_script("Storage.prototype.setItem = () => { throw new Error('storage full'); };")
            full_storage.goto(f'http://127.0.0.1:{server.server_port}/article.html?slug=transactional-outbox')
            full_storage.locator('#recommendations').wait_for(state='visible', timeout=20000)
            full_card = full_storage.locator('#recommendations-list .recent-item').first
            full_favorite = full_card.locator('.favorite-button')
            full_favorite.click()
            full_card.focus()
            full_storage.keyboard.press('Enter')
            full_popup = full_storage.locator('#article-quick-actions')
            full_popup.wait_for(state='visible')
            assert full_popup.locator('[data-quick-action="favorite"]').get_attribute('aria-pressed') == 'true'
            full_storage.keyboard.press('Escape')
            full_favorite.click()
            assert full_favorite.get_attribute('aria-pressed') == 'false'
            full_storage.close()
            for failing_method in ('recommendArticles', 'createCards'):
                failure = browser.new_page()
                failure.add_init_script("""document.addEventListener('tech-topics:article-ready', () => {
                    window.TechTopicsCards.%s = () => { throw new Error('simulated recommendation failure'); };
                });""" % failing_method)
                errors = []
                failure.on('pageerror', lambda error: errors.append(str(error)))
                failure.goto(f'http://127.0.0.1:{server.server_port}/article.html?slug=transactional-outbox')
                failure.locator('#article-actions').wait_for(state='visible', timeout=20000)
                assert 'Outbox' in failure.locator('#article-heading').inner_text()
                assert len(failure.locator('#article-body').inner_text()) > 100
                assert failure.locator('#recommendations').is_hidden()
                failure.locator('#favorite-article').click()
                assert failure.locator('#favorite-article').get_attribute('aria-pressed') == 'true'
                assert failure.locator('.site-footer').count() == 1
                assert not errors, errors
                failure.close()
            print('PASS: recommendation navigation, layout, keyboard and touch favorite/share preview')
        finally:
            browser.close()
finally:
    server.shutdown()
    server.server_close()
