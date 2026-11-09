from PIL import Image, ImageDraw, ImageFont

CINNABAR = (195, 39, 43, 255)
PAPER = (247, 244, 236, 255)

def make(size, radius_ratio=0.22, font_path="C:/Windows/Fonts/STSONG.TTF", pad_ratio=0.18):
    scale = 4
    S = size * scale
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(S * radius_ratio)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=CINNABAR)
    # inner hairline
    inset = int(S * 0.045)
    d.rounded_rectangle(
        [inset, inset, S - 1 - inset, S - 1 - inset],
        radius=max(2, int(r * 0.82)),
        outline=(247, 244, 236, 90),
        width=max(1, int(S * 0.012)),
    )
    font_size = int(S * (1 - 2 * pad_ratio))
    font = ImageFont.truetype(font_path, font_size)
    text = "诗"
    bbox = d.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    d.text(
        ((S - w) / 2 - bbox[0], (S - h) / 2 - bbox[1] - S * 0.005),
        text,
        font=font,
        fill=PAPER,
    )
    return img.resize((size, size), Image.LANCZOS)

base = make(512)
base.save("public/assets/img/icon-512.png")
base.resize((192, 192), Image.LANCZOS).save("public/assets/img/icon-192.png")
make(180).save("public/assets/img/apple-touch-icon.png")
make(64).save("public/assets/img/icon-64.png")

ico_sizes = [(16, 16), (32, 32), (48, 48)]
imgs = [make(s).convert("RGBA") for s, _ in ico_sizes]
imgs[0].save("public/favicon.ico", format="ICO", sizes=ico_sizes, append_images=imgs[1:])
print("icons done")
