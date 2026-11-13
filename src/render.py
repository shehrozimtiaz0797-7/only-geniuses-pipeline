"""Draws the quiz Short frame by frame and sends the frames straight to ffmpeg (no pictures from the internet).

Usage: python render.py spec.json
"""
import json
import math
import random
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

spec = json.load(open(sys.argv[1], encoding="utf-8"))
W, H, FPS = spec.get("width", 1080), spec.get("height", 1920), spec.get("fps", 30)
C = {k: tuple(v) for k, v in spec["colors"].items()}
FB, FM = spec["font_bold"], spec["font_medium"]
rng = random.Random(spec.get("seed", 7))
_fonts = {}
SS = 3      # draw shapes 3x bigger then shrink = smooth edges
PAD = 44    # room around a layer for its shadow / glow


# ---------- small helpers ----------
def font(size, bold=True):
    key = (size, bold)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(FB if bold else FM, size)
    return _fonts[key]


def wrap(text, f, max_w):
    lines = []
    for para in str(text).split("\n"):
        cur = ""
        for word in para.split():
            test = (cur + " " + word).strip()
            if f.getlength(test) <= max_w or not cur:
                cur = test
            else:
                lines.append(cur)
                cur = word
        lines.append(cur)
    return lines


def fit(text, max_w, max_h, start, smallest, bold=True, gap=1.22, max_lines=7):
    size = start
    while True:
        f = font(size, bold)
        lines = wrap(text, f, max_w)
        lh = int(size * gap)
        too_wide = any(f.getlength(l) > max_w for l in lines)
        if (len(lines) * lh <= max_h and len(lines) <= max_lines and not too_wide) or size <= smallest:
            return f, lines, lh
        size -= 2


def draw_lines(d, lines, f, lh, cx, top, fill):
    for i, line in enumerate(lines):
        d.text((cx, top + i * lh + lh // 2), line, font=f, fill=fill, anchor="mm")


def layer(w, h):
    return Image.new("RGBA", (w, h), (0, 0, 0, 0))


def with_alpha(img, a):
    if a >= 1:
        return img
    r, g, b, al = img.split()
    al = al.point(lambda v: int(v * max(0.0, a)))
    return Image.merge("RGBA", (r, g, b, al))


def ease(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3


def back(x):
    x = max(0.0, min(1.0, x))
    c1 = 1.70158
    return 1 + (c1 + 1) * (x - 1) ** 3 + c1 * (x - 1) ** 2


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def lighter(c, n):
    return tuple(min(255, v + n) for v in c)


def rr_mask(w, h, r):
    m = Image.new("L", (w * SS, h * SS), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w * SS - 1, h * SS - 1], radius=r * SS, fill=255)
    return m.resize((w, h), Image.LANCZOS)


def circle(d_size, fill):
    m = Image.new("L", (d_size * SS, d_size * SS), 0)
    ImageDraw.Draw(m).ellipse([0, 0, d_size * SS - 1, d_size * SS - 1], fill=255)
    out = Image.new("RGBA", (d_size, d_size), fill + (255,))
    out.putalpha(m.resize((d_size, d_size), Image.LANCZOS))
    return out


def gradient_box(w, h, r, top, bottom, border=None):
    grad = Image.new("RGBA", (w, h))
    gd = ImageDraw.Draw(grad)
    for y in range(h):
        gd.line([(0, y), (w, y)], fill=mix(top, bottom, y / max(1, h - 1)) + (255,))
    out = layer(w, h)
    out.paste(grad, (0, 0), rr_mask(w, h, r))
    if border:
        ring = layer(w * SS, h * SS)
        ImageDraw.Draw(ring).rounded_rectangle([0, 0, w * SS - 1, h * SS - 1], radius=r * SS, outline=border, width=3 * SS)
        out.alpha_composite(ring.resize((w, h), Image.LANCZOS))
    return out


def shadowed(img, blur=20, off=(0, 14), opacity=0.5, color=(0, 0, 0)):
    """Returns the image with a soft shadow (or glow) under it, PAD pixels bigger on each side."""
    w, h = img.size
    out = layer(w + 2 * PAD, h + 2 * PAD)
    a = img.split()[3].point(lambda v: int(v * opacity))
    sh = Image.new("RGBA", (w, h), color + (255,))
    sh.putalpha(a)
    tmp = layer(w + 2 * PAD, h + 2 * PAD)
    tmp.alpha_composite(sh, (PAD + off[0], PAD + off[1]))
    out.alpha_composite(tmp.filter(ImageFilter.GaussianBlur(blur)))
    out.alpha_composite(img, (PAD, PAD))
    return out


def scaled(img, s):
    if abs(s - 1) < 0.003:
        return img
    return img.resize((max(1, int(img.size[0] * s)), max(1, int(img.size[1] * s))), Image.BILINEAR)


def put_center(frame, img, cx, cy, a=1.0):
    frame.alpha_composite(with_alpha(img, a), (int(cx - img.size[0] / 2), int(cy - img.size[1] / 2)))


# ---------- background (moving glows + floating particles) ----------
base = Image.new("RGB", (W, H))
bd = ImageDraw.Draw(base)
for y in range(H):
    bd.line([(0, y), (W, y)], fill=mix(C["bgTop"], C["bgBottom"], y / (H - 1)))
base = base.convert("RGBA")


def glow(size, color, opacity):
    small = size // 4
    m = Image.new("L", (small, small), 0)
    ImageDraw.Draw(m).ellipse([small * 0.2, small * 0.2, small * 0.8, small * 0.8], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(small / 7)).resize((size, size), Image.BILINEAR)
    g = Image.new("RGBA", (size, size), color + (255,))
    g.putalpha(m.point(lambda v: int(v * opacity)))
    return g


glows = [
    (glow(900, (110, 60, 255), 0.55), 0.25, 0.30, 0.31, 0.0),
    (glow(760, (255, 50, 150), 0.30), 0.80, 0.55, 0.23, 2.1),
    (glow(980, (0, 150, 255), 0.30), 0.40, 0.85, 0.19, 4.2),
]
particles = [(rng.uniform(0, W), rng.uniform(0, H), rng.uniform(18, 55), rng.choice([2, 3, 3, 4, 5]), rng.uniform(0, 6.28))
             for _ in range(48)]


def background(t):
    fr = base.copy()
    for g, px, py, sp, ph in glows:
        cx = W * px + 140 * math.sin(t * sp + ph)
        cy = H * py + 110 * math.cos(t * sp * 0.8 + ph)
        fr.alpha_composite(g, (int(cx - g.size[0] / 2), int(cy - g.size[1] / 2)))
    d = ImageDraw.Draw(fr)
    for x0, y0, sp, r, ph in particles:
        y = (y0 - sp * t) % (H + 20) - 10
        x = x0 + 12 * math.sin(t * 0.9 + ph)
        tw = 0.55 + 0.45 * math.sin(t * 2.2 + ph)
        d.ellipse([x - r, y - r, x + r, y + r], fill=mix(C["bgTop"], (200, 190, 255), 0.25 + 0.35 * tw) + (255,))
    return fr


# ---------- fixed parts ----------
M = 110
CW = W - 2 * M
TOP_TIMER = 440
CARD_Y = 540
OPT_H, OPT_GAP = 118, 24

brand = layer(W, 80)
d = ImageDraw.Draw(brand)
d.text((W // 2, 40), " ".join(spec["brand"]), font=font(40), fill=C["accent"] + (255,), anchor="mm")
brand = shadowed(brand, blur=10, off=(0, 0), opacity=0.6, color=C["accent"])  # soft glow

kind = spec.get("kindLabel", "").upper()
kind_img = None
if kind:
    kf = font(28, False)
    kw = int(kf.getlength(kind)) + 44
    kind_img = layer(kw, 52)
    ring = layer(kw * SS, 52 * SS)
    ImageDraw.Draw(ring).rounded_rectangle([0, 0, kw * SS - 1, 52 * SS - 1], radius=26 * SS, outline=C["accent"] + (255,), width=3 * SS)
    kind_img.alpha_composite(ring.resize((kw, 52), Image.LANCZOS))
    ImageDraw.Draw(kind_img).text((kw // 2, 27), kind, font=kf, fill=C["accent"] + (255,), anchor="mm")


def banner(text, top, bottom, text_fill):
    img = gradient_box(CW + 40, 120, 30, top, bottom)
    dd = ImageDraw.Draw(img)
    f, lines, lh = fit(text, CW - 20, 104, 62, 34, max_lines=2)
    draw_lines(dd, lines, f, lh, (CW + 40) // 2, (120 - len(lines) * lh) // 2, text_fill + (255,))
    return img


hook_plain = banner(spec["hook"], lighter(C["accent"], 40), C["accent"], C["cardText"])
hook_img = shadowed(hook_plain, opacity=0.55)
opt_ans = spec["options"][spec["answerIndex"]]
ans_text = "ANSWER: " + (opt_ans if len(opt_ans) <= 14 else "ABCD"[spec["answerIndex"]])
answer_img = shadowed(banner(ans_text, lighter(C["correct"], 30), C["correct"], (255, 255, 255)), opacity=0.55)

# shine that sweeps across the hook banner
shine = layer(CW + 40, 120)
sd = ImageDraw.Draw(shine)
for i in range(70):
    a = int(110 * (1 - abs(i - 35) / 35))
    sd.line([(i, 120), (i + 60, 0)], fill=(255, 255, 255, a))
shine_mask = rr_mask(CW + 40, 120, 30)


def hook_with_shine(p):
    img = hook_plain.copy()
    strip = layer(CW + 40, 120)
    strip.alpha_composite(shine, (int(-140 + (CW + 220) * p), 0))
    clip = layer(CW + 40, 120)
    clip.paste(strip, (0, 0), shine_mask)
    img.alpha_composite(clip)
    return shadowed(img, opacity=0.55)


# question card
qf, qlines, qlh = fit(spec["question"], CW - 100, 380, 66, 40)
card_h = max(240, len(qlines) * qlh + 100)
card_plain = gradient_box(CW, card_h, 38, (255, 255, 255), (232, 230, 245))
draw_lines(ImageDraw.Draw(card_plain), qlines, qf, qlh, CW // 2, (card_h - len(qlines) * qlh) // 2, C["cardText"] + (255,))
card = shadowed(card_plain, blur=26, off=(0, 18), opacity=0.6)
OPT_Y = CARD_Y + card_h + 36


def pill(letter, text, top, bottom, letter_fill, letter_text, text_fill, mark=None, border=(255, 255, 255, 45)):
    img = gradient_box(CW, OPT_H, OPT_H // 2, top, bottom, border=border)
    dd = ImageDraw.Draw(img)
    cimg = circle(84, letter_fill)
    img.alpha_composite(cimg, (64 - 42, OPT_H // 2 - 42))
    dd.text((64, OPT_H // 2 + 2), letter, font=font(46), fill=letter_text + (255,), anchor="mm")
    room = CW - 150 - (90 if mark else 40)
    f, lines, lh = fit(text, room, OPT_H - 16, 52, 30, max_lines=2, gap=1.1)
    top_y = (OPT_H - len(lines) * lh) // 2
    for i, line in enumerate(lines):
        dd.text((132, top_y + i * lh + lh // 2), line, font=f, fill=text_fill + (255,), anchor="lm")
    if mark:
        big = layer(120 * SS, OPT_H * SS)
        bdd = ImageDraw.Draw(big)
        x, y = 60 * SS, OPT_H * SS // 2
        if mark == "check":
            bdd.line([(x - 28 * SS, y + 2 * SS), (x - 8 * SS, y + 24 * SS), (x + 30 * SS, y - 24 * SS)], fill=(255, 255, 255, 255), width=13 * SS, joint="curve")
        else:
            col = (255, 110, 120, 200)
            bdd.line([(x - 18 * SS, y - 18 * SS), (x + 18 * SS, y + 18 * SS)], fill=col, width=9 * SS)
            bdd.line([(x - 18 * SS, y + 18 * SS), (x + 18 * SS, y - 18 * SS)], fill=col, width=9 * SS)
        img.alpha_composite(big.resize((120, OPT_H), Image.LANCZOS), (CW - 135, 0))
    return img


opts = spec["options"]
ai = spec["answerIndex"]
pills = [shadowed(pill("ABCD"[i], o, lighter(C["option"], 26), C["option"], C["letter"], C["option"], C["optionText"]), opacity=0.45)
         for i, o in enumerate(opts)]
right_plain = pill("ABCD"[ai], opts[ai], lighter(C["correct"], 30), C["correct"], (255, 255, 255), C["correct"], (255, 255, 255),
                   mark="check", border=(255, 255, 255, 110))
pill_right = shadowed(right_plain, opacity=0.45)
right_glow = shadowed(right_plain, blur=24, off=(0, 0), opacity=1.0, color=C["correct"])
pill_wrong = [shadowed(pill("ABCD"[i], o, C["wrong"], mix(C["wrong"], (0, 0, 0), 0.15), (150, 140, 180), C["wrong"], (175, 168, 200), mark="x"),
                       opacity=0.3) for i, o in enumerate(opts)]


def opt_center(i):
    return M + CW / 2, OPT_Y + i * (OPT_H + OPT_GAP) + OPT_H / 2


# texts
def text_layer(text, size, bold, fill, h=70):
    img = layer(W, h)
    ImageDraw.Draw(img).text((W // 2, h // 2), text, font=font(size, bold), fill=fill, anchor="mm")
    return shadowed(img, blur=6, off=(0, 3), opacity=0.7)


CTA_Y = OPT_Y + 4 * OPT_H + 3 * OPT_GAP + 30
cta = text_layer(spec.get("cta", "Pause & comment A, B, C or D!"), 40, False, (255, 255, 255, 235))
end_cta = text_layer("Did you get it right? Comment below!", 42, True, C["accent"] + (255,))

ef, elines, elh = fit(spec["explanation"], CW + 60, 180, 50, 30, bold=False, gap=1.18, max_lines=4)
expl = layer(W, 190)
draw_lines(ImageDraw.Draw(expl), elines, ef, elh, W // 2, (190 - len(elines) * elh) // 2, (255, 255, 255, 255))
expl = shadowed(expl, blur=8, off=(0, 3), opacity=0.8)

# red edge flash for the last seconds
vs = 4
vm = Image.new("L", (W // vs, H // vs), 255)
ImageDraw.Draw(vm).rounded_rectangle([W // vs * 0.10, H // vs * 0.07, W // vs * 0.90, H // vs * 0.93], radius=60, fill=0)
vm = vm.filter(ImageFilter.GaussianBlur(28)).resize((W, H), Image.BILINEAR)
vignette = Image.new("RGBA", (W, H), (255, 30, 50, 255))
vignette.putalpha(vm.point(lambda v: int(v * 0.75)))


def timer(remaining, total):
    S = 2
    R = 72 * S
    size = 2 * R + 24 * S
    img = layer(size, size)
    dd = ImageDraw.Draw(img)
    c = size // 2
    box = [c - R, c - R, c + R, c + R]
    dd.ellipse(box, fill=(10, 8, 30, 200))
    dd.arc(box, 0, 360, fill=(255, 255, 255, 50), width=14 * S)
    frac = max(0.0, min(1.0, remaining / total))
    col = C["accent"] if remaining > 3 else (255, 70, 80)
    if frac > 0:
        dd.arc(box, -90, -90 + 360 * frac, fill=col + (255,), width=14 * S)
    num = str(max(1, int(remaining + 0.999))) if remaining > 0 else "0"
    dd.text((c, c + 4 * S), num, font=font((76 if len(num) == 1 else 60) * S), fill=(255, 255, 255, 255), anchor="mm")
    img = img.resize((size // S, size // S), Image.LANCZOS)
    return shadowed(img, blur=14, off=(0, 0), opacity=0.55, color=col)


# confetti for the answer
CONF_COLORS = [(255, 204, 0), (34, 197, 94), (59, 130, 246), (236, 72, 153), (255, 255, 255), (168, 85, 247)]
confetti = []
for side in (-1, 1):
    for _ in range(95):
        ang = math.radians(rng.uniform(55, 85))
        sp = rng.uniform(1500, 2500)
        confetti.append(dict(x=W / 2 + side * (W / 2 + 10), y=H * 0.72, vx=-side * sp * math.cos(ang), vy=-sp * math.sin(ang),
                             r=rng.uniform(0, 6.28), vr=rng.uniform(-12, 12), w=rng.uniform(18, 32), h=rng.uniform(10, 17),
                             c=rng.choice(CONF_COLORS)))


def draw_confetti(frame, t):
    if t <= 0 or t > 3.0:
        return
    d = ImageDraw.Draw(frame)
    g = 2600
    for p in confetti:
        drag = 1 - math.exp(-2.2 * t)
        x = p["x"] + p["vx"] * drag / 2.2
        y = p["y"] + p["vy"] * drag / 2.2 + 0.5 * g * t * t * 0.35
        if y > H + 40:
            continue
        a = p["r"] + p["vr"] * t
        flip = abs(math.cos(a * 1.7))
        hw, hh = p["w"] / 2, p["h"] / 2 * (0.3 + 0.7 * flip)
        ca, sa = math.cos(a), math.sin(a)
        pts = [(x + ca * dx - sa * dy, y + sa * dx + ca * dy) for dx, dy in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh))]
        d.polygon(pts, fill=p["c"] + (255,))


# ---------- timeline ----------
TQ = float(spec["t_question"])
CD = float(spec["countdown"])
TR = float(spec["t_reveal"])
TOTAL = TQ + CD + TR
frames = int(round(TOTAL * FPS))
BANNER_CY = 225 + 60

ff = subprocess.Popen([spec["ffmpeg"], "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                       "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium",
                       "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high", spec["out"]], stdin=subprocess.PIPE)

fg_cache = {}


def top_parts(fr):
    fr.alpha_composite(brand, (-PAD, 75 - PAD))
    if kind_img:
        fr.alpha_composite(kind_img, ((W - kind_img.size[0]) // 2, 150))


for n in range(frames):
    t = n / FPS
    frame = background(t)
    tr = t - (TQ + CD)

    if t < TQ + CD:
        settled = t >= 1.3
        if settled and "q" in fg_cache:
            frame.alpha_composite(fg_cache["q"])
        else:
            fg = layer(W, H)
            top_parts(fg)
            # banner drops in, then a shine sweeps across it
            b = back(t / 0.45)
            by = -160 + (BANNER_CY + 160) * b
            sp = (t - 0.55) / 0.5
            img = hook_with_shine(sp) if 0 < sp < 1 else hook_img
            put_center(fg, img, W / 2, by, min(1.0, t / 0.15))
            # card pops in
            cs = 0.82 + 0.18 * back((t - 0.12) / 0.45)
            if t > 0.12:
                put_center(fg, scaled(card, cs), W / 2, CARD_Y + card_h / 2, ease((t - 0.12) / 0.25))
            # options slide in one by one
            for i, p in enumerate(pills):
                pa = (t - 0.45 - 0.12 * i) / 0.35
                if pa > 0:
                    cx, cy = opt_center(i)
                    put_center(fg, p, cx + 260 * (1 - back(pa)), cy, ease(pa * 1.6))
            if settled:
                fg_cache["q"] = fg
            frame.alpha_composite(fg)

        # timer
        if t < TQ:
            if t > 0.3:
                tm = timer(CD, CD)
                put_center(frame, scaled(tm, 0.7 + 0.3 * back((t - 0.3) / 0.4)), W / 2, TOP_TIMER, ease((t - 0.3) / 0.3))
        else:
            rem = CD - (t - TQ)
            into = (t - TQ) % 1.0
            pulse = 1 + 0.12 * max(0.0, 1 - into / 0.22)
            put_center(frame, scaled(timer(rem, CD), pulse), W / 2, TOP_TIMER)
            put_center(frame, cta, W / 2, CTA_Y + 35, ease((t - TQ) / 0.3) * (0.8 + 0.2 * math.sin(t * 6)))
            if rem <= 3:
                frame.alpha_composite(with_alpha(vignette, 0.25 + 0.75 * max(0.0, 1 - into / 0.5)))
    else:
        settled = tr >= 1.0
        if settled and "r" in fg_cache:
            frame.alpha_composite(fg_cache["r"])
        else:
            fg = layer(W, H)
            top_parts(fg)
            put_center(fg, scaled(answer_img, 0.85 + 0.15 * back(tr / 0.4)), W / 2, BANNER_CY)
            fg.alpha_composite(card, (M - PAD, CARD_Y - PAD))
            for i in range(4):
                cx, cy = opt_center(i)
                if i != ai:
                    put_center(fg, pill_wrong[i], cx, cy, 0.85)
            ea = ease((tr - 0.25) / 0.4)
            if ea > 0:
                put_center(fg, expl, W / 2, TOP_TIMER + 3 + 20 * (1 - ea), ea)
            if settled:
                fg_cache["r"] = fg
            frame.alpha_composite(fg)

        # correct option: pop + breathing glow
        cx, cy = opt_center(ai)
        glow_a = 0.55 + 0.35 * math.sin(tr * 4.0) if tr > 0.4 else min(1.0, tr / 0.15)
        put_center(frame, right_glow, cx, cy, glow_a)
        s = 1 + 0.07 * max(0.0, 1 - abs(tr - 0.18) / 0.18) if tr < 0.36 else 1
        put_center(frame, scaled(pill_right, s), cx, cy)

        draw_confetti(frame, tr - 0.05)
        if tr > 1.0:
            put_center(frame, end_cta, W / 2, CTA_Y + 35, ease((tr - 1.0) / 0.4))
        if tr < 0.25:
            flash = Image.new("RGBA", (W, H), (255, 255, 255, int(110 * (1 - tr / 0.25))))
            frame.alpha_composite(flash)

    ff.stdin.write(frame.convert("RGB").tobytes())

ff.stdin.close()
sys.exit(ff.wait())
