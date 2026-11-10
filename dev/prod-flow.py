from playwright.sync_api import sync_playwright
BASE="https://yinshi-80u.pages.dev"
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome")
    ctx=b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="zh-CN")
    pg=ctx.new_page()
    pg.goto(BASE+"/register.html", wait_until="networkidle")
    pg.fill("#username","shijing_demo"); pg.fill("#password","poem123456")
    pg.click("#auth-submit"); pg.wait_for_timeout(2500)
    print("url:", pg.url)
    pg.fill("#description","秋夜江边，孤舟灯火，思念远人")
    pg.click("#submit-btn"); pg.wait_for_timeout(3000)
    print("poem:", pg.inner_text("#poem-title"))
    print("imagery:", pg.inner_text("#imagery-chips").replace("\n"," / "))
    print("validation:", pg.inner_text("#validation-note")[:30])
    pg.screenshot(path="dev/shots/prod-mobile-result.png", full_page=True)
    b.close()
