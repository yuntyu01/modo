#!/usr/bin/env python3
"""PC 아이콘(assets/icon.ico, icon.png)을 로고 선 경로에서 크기마다 다시 그린다.

- 둥근 사각형 바탕(앱 아이콘과 같은 #0E0F11) + 대표색 심볼(app/src/ui/Logo.tsx의 선 경로와 같은 모양).
- 크기마다 8배로 그려 줄인다(슈퍼샘플링): 큰 그림 하나를 줄일 때보다 작은 크기에서 또렷하다.
- 16~24px은 선을 조금 굵게(작업 표시줄에서 읽히게).
사용: python3 scripts/make-icon.py   (desktop 폴더에서)
"""
import math
import os

from PIL import Image, ImageDraw

BG = (14, 15, 17, 255)
MARK = (133, 173, 226, 255)  # src/brand.ts BRAND #85ADE2
# Logo.tsx: viewBox 51.8 438.8 1148.5 432, 선 굵기 145.5, 둥근 끝·꺾임
VB = (51.8, 438.8, 1148.5, 432.0)
STROKE = 145.5
SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
SS = 8


def mark_points():
    """선 경로를 점 목록 둘로(M에서 끊긴다). 호는 시계 방향(화면 기준) 위쪽 반원."""
    def arc(x0, x1, y, steps=90):
        cx, r = (x0 + x1) / 2, (x1 - x0) / 2
        return [(cx - r * math.cos(math.pi * i / steps), y - r * math.sin(math.pi * i / steps)) for i in range(steps + 1)]

    a = [(124.5, 794.5)] + arc(124.5, 471.5, 764.5) + [(471.5, 796.2)]
    b = [(496.0, 796.2)] + arc(496.0, 843.0, 764.5) + [(843.0, 779.5), (883.0, 798.0), (1127.5, 511.5)]
    return [a, b]


def render(size):
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 둥근 사각형: 큰 크기는 가장자리에 살짝 여백, 작은 크기는 꽉 채운다
    m = 0 if size <= 24 else round(S * 0.035)
    d.rounded_rectangle([m, m, S - 1 - m, S - 1 - m], radius=(S - 2 * m) * 0.235, fill=BG)
    # 심볼: 바탕 폭의 70%(작은 크기는 76%), 가운데
    inner = S - 2 * m
    w = inner * (0.76 if size <= 24 else 0.70)
    k = w / VB[2]
    ox = (S - w) / 2 - VB[0] * k
    oy = (S - VB[3] * k) / 2 - VB[1] * k
    bold = 1.35 if size <= 20 else 1.2 if size <= 24 else 1.08 if size <= 48 else 1.0
    r = STROKE * k * bold / 2
    for pts in mark_points():
        p = [(ox + x * k, oy + y * k) for x, y in pts]
        d.line(p, fill=MARK, width=max(1, round(r * 2)))
        for x, y in p:
            d.ellipse([x - r, y - r, x + r, y + r], fill=MARK)
    return img.resize((size, size), Image.LANCZOS)


def main():
    here = os.path.join(os.path.dirname(__file__), '..', 'assets')
    imgs = [render(s) for s in SIZES]
    big = imgs[-1]
    big.save(os.path.join(here, 'icon.ico'), sizes=[(s, s) for s in SIZES], append_images=imgs[:-1])
    render(512).save(os.path.join(here, 'icon.png'))
    print('icon.ico', SIZES, 'icon.png 512')


if __name__ == '__main__':
    main()
