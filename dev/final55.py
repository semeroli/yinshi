from playwright.sync_api import sync_playwright
BASE="https://yinshi-55w.pages.dev"
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome")
    ctx=b.new_context(viewport={"width":1440,"height":900}, locale="zh-CN")
    pg=ctx.new_page()
    errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE+"/", wait_until="networkidle"); pg.wait_for_timeout(700)
    pg.screenshot(path="dev/shots/live-home.png")
    pg.goto(BASE+"/blog.html", wait_until="networkidle"); pg.wait_for_timeout(800)
    print("cards:", pg.locator(".post-card").count())
    pg.screenshot(path="dev/shots/live-blog.png", full_page=True)
    pg.goto(BASE+"/post.html?slug=wuyan-pingze-rumen", wait_until="networkidle"); pg.wait_for_timeout(600)
    print("post:", pg.inner_text("#article-title"))
    print("cover loaded:", pg.eval_on_selector("#article-cover","e=>e.complete && e.naturalWidth>0"))
    m=b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="zh-CN")
    mp=m.new_page()
    mp.goto(BASE+"/login.html", wait_until="networkidle"); mp.wait_for_timeout(500)
    mp.screenshot(path="dev/shots/live-mobile-login.png")
    print("errors:", errs[:3])
    b.close()
