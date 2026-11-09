from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome")
    pg=b.new_page()
    pg.goto("http://localhost:5180/post.html?slug=yixiang-zenme-xuan", wait_until="networkidle")
    pg.wait_for_timeout(500)
    html=pg.eval_on_selector("#article-body","e=>e.innerHTML")
    print(html[:1200])
    b.close()
