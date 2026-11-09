from playwright.sync_api import sync_playwright
BASE="http://localhost:5180"
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome")
    m=b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="zh-CN")
    pg=m.new_page()
    pg.goto(f"{BASE}/blog.html", wait_until="networkidle"); pg.wait_for_timeout(600)
    box=pg.locator(".topbar-inner").bounding_box()
    brand=pg.locator(".topbar .brand").bounding_box()
    print("topbar h", round(box["height"]), "| brand w", round(brand["width"]))
    pg.screenshot(path="dev/shots/mobile-blog-top.png")

    d=b.new_context(viewport={"width":1440,"height":900}, locale="zh-CN")
    dp=d.new_page()
    dp.goto(f"{BASE}/", wait_until="networkidle"); dp.wait_for_timeout(500)
    print("landing nav:", dp.inner_text(".topnav").replace("\n"," / "))
    dp.goto(f"{BASE}/app.html", wait_until="networkidle"); dp.wait_for_timeout(600)
    print("app url:", dp.url)
    b.close()
