from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome")
    ctx=b.new_context(viewport={"width":1440,"height":960})
    ctx.request.post("http://localhost:5180/api/auth/login", data={"username":"admin","password":"admin123456"})
    pg=ctx.new_page()
    pg.goto("http://localhost:5180/admin-editor.html?id=1", wait_until="networkidle")
    pg.wait_for_timeout(800)
    print("len", pg.eval_on_selector("#content","e=>e.value.length"))
    print("counter", pg.inner_text("#content-count"))
    print("style", pg.eval_on_selector("#content","e=>{const s=getComputedStyle(e);return s.color+'|'+s.fontSize+'|'+s.backgroundColor+'|'+s.height}"))
    b.close()
