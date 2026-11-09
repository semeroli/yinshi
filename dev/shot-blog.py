from playwright.sync_api import sync_playwright
BASE="http://localhost:5180"
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome")
    ctx=b.new_context(viewport={"width":1440,"height":960}, locale="zh-CN")
    pg=ctx.new_page()
    msgs=[]
    pg.on("console", lambda m: msgs.append(f"{m.type}:{m.text}") if m.type in ("error","warning") else None)

    pg.goto(f"{BASE}/blog.html", wait_until="networkidle"); pg.wait_for_timeout(900)
    print("cards", pg.locator(".post-card").count())
    pg.screenshot(path="dev/shots/blog-list.png", full_page=True)

    pg.goto(f"{BASE}/post.html?slug=yixiang-zenme-xuan", wait_until="networkidle"); pg.wait_for_timeout(700)
    print("post title", pg.inner_text("#article-title"))
    print("h2 count", pg.locator(".prose h2").count(), "| table", pg.locator(".prose table, .prose p").count())
    pg.screenshot(path="dev/shots/post-detail.png", full_page=True)

    # 管理员
    r=ctx.request.post(f"{BASE}/api/auth/login", data={"username":"admin","password":"admin123456"})
    print("login", r.status)
    pg.goto(f"{BASE}/admin-posts.html", wait_until="networkidle"); pg.wait_for_timeout(800)
    print("rows", pg.locator("#post-rows tr").count())
    pg.screenshot(path="dev/shots/admin-posts.png", full_page=True)

    pg.goto(f"{BASE}/admin-editor.html?id=1", wait_until="networkidle"); pg.wait_for_timeout(900)
    print("loaded title", pg.input_value("#title"))
    pg.screenshot(path="dev/shots/editor.png", full_page=True)

    # 移动端
    m=b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="zh-CN")
    mp=m.new_page()
    mp.goto(f"{BASE}/blog.html", wait_until="networkidle"); mp.wait_for_timeout(800)
    mp.screenshot(path="dev/shots/mobile-blog.png", full_page=True)
    mp.goto(f"{BASE}/post.html?slug=wuyan-pingze-rumen", wait_until="networkidle"); mp.wait_for_timeout(600)
    mp.screenshot(path="dev/shots/mobile-post.png", full_page=True)
    print("console", msgs[:6])
    b.close()
