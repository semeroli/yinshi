from playwright.sync_api import sync_playwright
BASE="http://localhost:5180"
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome")

    # 1. 非管理员访问管理页
    ctx=b.new_context(viewport={"width":1280,"height":900})
    ctx.request.post(f"{BASE}/api/auth/register", data={"username":"reader01","password":"reader123456"})
    ctx.request.post(f"{BASE}/api/auth/login", data={"username":"reader01","password":"reader123456"})
    pg=ctx.new_page()
    pg.goto(f"{BASE}/admin-posts.html", wait_until="networkidle"); pg.wait_for_timeout(700)
    print("forbidden visible:", pg.locator("#forbidden").is_visible())
    print("table hidden:", not pg.locator("#table-panel").is_visible())

    # 2. 管理员 UI 新建草稿并发布
    ctx2=b.new_context(viewport={"width":1280,"height":900})
    ctx2.request.post(f"{BASE}/api/auth/login", data={"username":"admin","password":"admin123456"})
    pg2=ctx2.new_page()
    pg2.goto(f"{BASE}/admin-editor.html", wait_until="networkidle"); pg2.wait_for_timeout(500)
    pg2.fill("#title","测试草稿：UI 创建")
    pg2.fill("#summary","这是一篇通过界面创建的测试文章。")
    pg2.fill("#content","## 小标题\n\n这是一段**正文**，用来验证编辑器的保存与预览。\n\n- 第一点\n- 第二点")
    pg2.fill("#cover_url","https://lingxi.wps.cn/api/aioffice/v1/short_link/3y42EU6ig")
    pg2.fill("#tags","测试, 草稿")
    pg2.wait_for_timeout(400)
    pg2.click("#btn-save-draft")
    pg2.wait_for_timeout(1200)
    print("after save url:", pg2.url)
    pg2.reload(wait_until="networkidle"); pg2.wait_for_timeout(700)
    print("status draft:", pg2.locator('.seg[data-status="draft"].is-active').count()==1)

    # 发布
    pg2.click('.seg[data-status="published"]')
    pg2.click("#btn-submit")
    pg2.wait_for_timeout(2000)
    print("redirect to post:", "/post.html?slug=" in pg2.url, pg2.url)
    print("article title:", pg2.inner_text("#article-title") if pg2.locator("#article-title").count() else "n/a")

    # 3. 后台删除该文
    pg2.goto(f"{BASE}/admin-posts.html", wait_until="networkidle"); pg2.wait_for_timeout(800)
    print("rows before delete:", pg2.locator("#post-rows tr").count())
    pg2.on("dialog", lambda d: d.accept())
    pg2.locator("#post-rows tr", has_text="测试草稿").locator("button.danger").click()
    pg2.wait_for_timeout(1200)
    print("rows after delete:", pg2.locator("#post-rows tr").count())
    b.close()
