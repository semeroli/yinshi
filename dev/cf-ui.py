from playwright.sync_api import sync_playwright
BASE="http://127.0.0.1:5190"
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome")
    ctx=b.new_context(viewport={"width":1440,"height":900}, locale="zh-CN")
    pg=ctx.new_page()
    errs=[]
    pg.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)

    # 注册普通用户
    pg.goto(f"{BASE}/register.html", wait_until="networkidle")
    pg.fill("#username","edge_reader"); pg.fill("#password","reader123456")
    pg.click("#auth-submit"); pg.wait_for_timeout(1800)
    print("after register:", pg.url)

    # 生成
    pg.goto(f"{BASE}/app.html", wait_until="networkidle"); pg.wait_for_timeout(600)
    pg.fill("#description","雨后空山，松间清泉，苔痕石径")
    pg.click("#submit-btn"); pg.wait_for_timeout(2500)
    print("poem:", pg.inner_text("#poem-title"), "|", pg.inner_text("#validation-note")[:40])

    # 非管理员访问文章管理
    pg.goto(f"{BASE}/admin-posts.html", wait_until="networkidle"); pg.wait_for_timeout(800)
    print("forbidden:", pg.locator("#forbidden").is_visible())

    # 前台诗话
    pg.goto(f"{BASE}/blog.html", wait_until="networkidle"); pg.wait_for_timeout(600)
    print("cards:", pg.locator(".post-card").count())
    pg.screenshot(path="dev/shots/cf-blog.png", full_page=True)

    # 管理员
    ctx2=b.new_context(viewport={"width":1440,"height":900}, locale="zh-CN")
    ctx2.request.post(f"{BASE}/api/auth/login", data={"username":"admin","password":"admin123456"})
    pg2=ctx2.new_page()
    pg2.goto(f"{BASE}/admin-posts.html", wait_until="networkidle"); pg2.wait_for_timeout(800)
    print("admin rows:", pg2.locator("#post-rows tr").count())
    pg2.screenshot(path="dev/shots/cf-admin.png", full_page=True)
    print("console errors:", errs[:3])
    b.close()
