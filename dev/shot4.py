from playwright.sync_api import sync_playwright
BASE="http://localhost:5180"
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome")
    pg=b.new_page(viewport={"width":1440,"height":900})
    pg.goto(f"{BASE}/index.html", wait_until="networkidle"); pg.wait_for_timeout(600)
    pg.screenshot(path="shots/desk-hero.png")
    m=b.new_page(viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    m.goto(f"{BASE}/index.html", wait_until="networkidle"); m.wait_for_timeout(600)
    m.screenshot(path="shots/mob-hero.png")
    m.screenshot(path="shots/mob-full.png", full_page=True)
    b.close()
