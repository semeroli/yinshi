from playwright.sync_api import sync_playwright
BASE="https://yinshi-80u.pages.dev"
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome")
    ctx=b.new_context(viewport={"width":1440,"height":900}, locale="zh-CN")
    pg=ctx.new_page()
    errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE+"/", wait_until="networkidle"); pg.wait_for_timeout(700)
    print("title:", pg.title())
    pg.screenshot(path="dev/shots/prod-home.png")
    pg.goto(BASE+"/blog.html", wait_until="networkidle"); pg.wait_for_timeout(900)
    print("cards:", pg.locator(".post-card").count())
    pg.screenshot(path="dev/shots/prod-blog.png", full_page=True)
    pg.goto(BASE+"/post.html?slug=yixiang-zenme-xuan", wait_until="networkidle"); pg.wait_for_timeout(700)
    print("post:", pg.inner_text("#article-title"), "| tables:", pg.locator(".prose table").count())
    m=b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="zh-CN")
    mp=m.new_page()
    mp.goto(BASE+"/app.html", wait_until="networkidle"); mp.wait_for_timeout(600)
    print("app url:", mp.url)
    mp.screenshot(path="dev/shots/prod-mobile-app.png")
    print("page errors:", errs[:3])
    b.close()
