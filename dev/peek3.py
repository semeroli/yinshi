from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome")
    ctx=b.new_context(viewport={"width":1200,"height":800})
    ctx.request.post("http://localhost:5180/api/auth/login", data={"username":"admin","password":"admin123456"})
    pg=ctx.new_page()
    pg.goto("http://localhost:5180/admin-editor.html?id=1", wait_until="networkidle")
    pg.wait_for_timeout(700)
    pg.eval_on_selector("#content","e=>e.scrollIntoView({block:'center'})")
    pg.wait_for_timeout(300)
    pg.screenshot(path="dev/shots/editor-content.png")
    b.close()
