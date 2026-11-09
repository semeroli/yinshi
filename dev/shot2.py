from playwright.sync_api import sync_playwright

BASE = "http://localhost:5180"
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    ctx = b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="zh-CN")
    r = ctx.request.post(f"{BASE}/api/auth/login", data={"username":"test_poet","password":"poem123456"})
    print("login", r.status)
    pg = ctx.new_page()
    pg.goto(f"{BASE}/index.html", wait_until="networkidle")
    pg.wait_for_timeout(600)
    pg.screenshot(path="shots/mobile-index2.png", full_page=True)

    pg.goto(f"{BASE}/app.html", wait_until="networkidle")
    pg.wait_for_timeout(600)
    pg.fill("#description", "雨后空山，松间清泉，苔痕石径")
    pg.click("#submit-btn")
    pg.wait_for_timeout(2500)
    pg.screenshot(path="shots/mobile-app-result.png", full_page=True)
    print("title", pg.title())
    print("poem", pg.inner_text("#poem-title"))
    # 打开诗笺抽屉
    pg.click("#open-history")
    pg.wait_for_timeout(500)
    pg.screenshot(path="shots/mobile-drawer.png")
    b.close()
