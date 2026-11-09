from playwright.sync_api import sync_playwright
BASE="http://localhost:5180"
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome")
    # 桌面
    ctx=b.new_context(viewport={"width":1440,"height":900}, device_scale_factor=1, locale="zh-CN")
    r=ctx.request.post(f"{BASE}/api/auth/login", data={"username":"admin","password":"admin123456"})
    print("login",r.status)
    pg=ctx.new_page()
    pg.goto(f"{BASE}/admin.html", wait_until="networkidle"); pg.wait_for_timeout(700)
    pg.screenshot(path="shots/admin-desktop.png", full_page=True)
    print("admin rows", pg.locator("#user-rows tr").count())

    # 收藏流程
    pg.goto(f"{BASE}/app.html", wait_until="networkidle")
    pg.fill("#description","春深小院，燕子双飞，落花满庭")
    pg.click("#submit-btn"); pg.wait_for_timeout(2200)
    pg.click("#btn-save"); pg.wait_for_timeout(400)
    print("saved toast", pg.locator(".toast").count())
    pg.click("#open-history"); pg.wait_for_timeout(600)
    pg.screenshot(path="shots/drawer-filled.png", full_page=False)
    print("history items", pg.locator(".hist-item").count())

    # 退出后访问 admin 应 403
    ctx2=b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="zh-CN")
    ctx2.request.post(f"{BASE}/api/auth/login", data={"username":"test_poet","password":"poem123456"})
    pg2=ctx2.new_page()
    pg2.goto(f"{BASE}/admin.html", wait_until="networkidle"); pg2.wait_for_timeout(700)
    print("forbidden visible", pg2.locator("#forbidden").is_visible())
    pg2.screenshot(path="shots/admin-forbidden.png", full_page=False)
    b.close()
