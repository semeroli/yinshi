import json, urllib.request, pathlib

base = "https://yinshi-80u.pages.dev"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      "Content-Type": "application/json", "Accept": "application/json"}

def call(path, payload=None, cookie=None, method=None):
    headers = dict(UA)
    if cookie: headers["Cookie"] = cookie
    req = urllib.request.Request(base + path, data=json.dumps(payload).encode() if payload is not None else None,
                                 method=method or ("POST" if payload is not None else "GET"), headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode()), r.headers.get("Set-Cookie")

_, ck = call("/api/auth/login", {"username": "admin", "password": "admin123456"})
cookie = ck.split(";")[0]

posts = json.loads(pathlib.Path("dev/posts.json").read_text(encoding="utf-8"))
for p in posts:
    res, _ = call("/api/admin/posts", p, cookie)
    print("created:", res["post"]["slug"], "| id", res["post"]["id"])
