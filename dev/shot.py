import sys
from playwright.sync_api import sync_playwright

pages = [("/index.html","mobile-index"),("/app.html","mobile-app"),("/register.html","mobile-register")]
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    ctx = b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="zh-CN")
    pg = ctx.new_page()
    for path,name in pages:
        pg.goto(f"http://localhost:5180{path}", wait_until="networkidle")
        pg.wait_for_timeout(800)
        pg.screenshot(path=f"dev/shots/{name}.png", full_page=True)
        print(name, pg.title())
    b.close()
