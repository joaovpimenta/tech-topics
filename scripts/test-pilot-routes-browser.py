"""Exercise the mixed corpus and clean routes at both Pages base paths."""
import functools
import os
import shutil
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

root = Path(os.environ.get('TECH_TOPICS_UI_ROOT', Path(__file__).resolve().parent.parent / 'dist'))
class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        pathname = urlsplit(path).path
        if pathname.startswith('/tech-topics/'):
            pathname = pathname[len('/tech-topics'):]
        return super().translate_path(pathname)
    def log_message(self, *_args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(root)))
Thread(target=server.serve_forever, daemon=True).start()
origin = f'http://127.0.0.1:{server.server_port}'
renderer = '''export default { initialize() {}, async render() {
 return {svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500"><text x="20" y="40">Diagrama</text></svg>`};
}};'''
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=os.environ.get('TECH_TOPICS_CHROMIUM') or shutil.which('chromium'))
        try:
            for prefix in ('', '/tech-topics'):
                page = browser.new_page(viewport={'width': 390, 'height': 844})
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                def route(request):
                    if 'mermaid.esm.min.mjs' in request.request.url:
                        request.fulfill(status=200, content_type='application/javascript', body=renderer)
                    elif request.request.url.startswith(origin + '/'):
                        request.continue_()
                    else:
                        request.abort()
                page.route('**/*', route)
                base = origin + prefix
                page.goto(base + '/bulkhead/#bh-operacao', wait_until='domcontentloaded')
                page.locator('#article-actions').wait_for(state='visible')
                assert 'Bulkhead' in page.locator('#article-heading').inner_text()
                page.wait_for_function('window.scrollY > 100')
                assert page.evaluate('location.hash') == '#bh-operacao'
                page.goto(base + '/bulkhead/#bh-problema', wait_until='domcontentloaded')
                page.locator('#article-actions').wait_for(state='visible')
                page.wait_for_function('window.scrollY > 100')
                page.go_back()
                page.wait_for_function("location.hash === '#bh-operacao' && window.scrollY > 100")
                page.go_forward()
                page.wait_for_function("location.hash === '#bh-problema' && window.scrollY > 100")
                assert page.locator('#article-image').evaluate('img => img.complete && img.naturalWidth > 0')
                page.locator('#recommendations').wait_for(state='visible')
                diagram = page.locator('.mermaid-diagram').first
                diagram.locator('.diagram-toolbar').wait_for(state='visible')
                svg = diagram.locator('svg')
                before = svg.bounding_box()['width']
                diagram.get_by_role('button', name='Ampliar diagrama', exact=True).click()
                assert svg.bounding_box()['width'] > before
                link = page.locator('#recommendations-list .recent-copy h3 a').first
                target = urlsplit(link.get_attribute('href')).path.strip('/').split('/')[-1]
                link.click()
                page.wait_for_url(base + '/' + target + '/')
                page.locator('#article-actions').wait_for(state='visible')
                assert page.locator('#article-heading').inner_text()
                page.goto(base + '/article.html?slug=bulkhead#bh-operacao', wait_until='domcontentloaded')
                page.locator('#article-actions').wait_for(state='visible')
                assert page.evaluate('location.hash') == '#bh-operacao'
                page.wait_for_function('window.scrollY > 100')
                page.locator('#article-search-input').fill('bulkhead')
                page.locator('#article-search-input').press('Enter')
                page.wait_for_url(base + '/index.html?q=bulkhead')
                page.locator('.recent-item').first.wait_for(state='visible')
                if os.environ.get('TECH_TOPICS_UI_SCREENSHOTS'):
                    directory = Path(os.environ['TECH_TOPICS_UI_SCREENSHOTS'])
                    directory.mkdir(parents=True, exist_ok=True)
                    for width in (390, 1280):
                        page.set_viewport_size({'width': width, 'height': 844})
                        page.goto(base + '/bulkhead/', wait_until='domcontentloaded')
                        page.locator('#article-actions').wait_for(state='visible')
                        page.screenshot(path=str(directory / f'bulkhead-{width}-{"project" if prefix else "root"}.png'))
                assert not errors, errors
                page.close()
        finally:
            browser.close()
finally:
    server.shutdown()
    server.server_close()
print('PASS: mixed corpus clean routes, recommendations, zoom and legacy links at both base paths')
