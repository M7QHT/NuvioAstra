"""Builds every Nuvio Astra app icon from the official artwork (branding/nuvio-astra.png).

The source image is used as is: same square canvas, colors, transparency and proportions. Smaller
sizes are produced by high-quality downscaling (Lanczos on premultiplied alpha, so transparent edges
keep their color); nothing is cropped, padded, sharpened or redrawn.

Usage: python -I make_icons.py <nextgen root>
"""
import shutil
import sys
from pathlib import Path

from PIL import Image

ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]


def scaled(src: Image.Image, size: int) -> Image.Image:
    if src.size == (size, size):
        return src.copy()
    return src.convert("RGBa").resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")


def main(root: Path) -> None:
    source_path = root / "packaging" / "branding" / "nuvio-astra.png"
    src = Image.open(source_path)
    src.load()
    assert src.mode == "RGBA" and src.size[0] == src.size[1], f"expected a square RGBA image, got {src.mode} {src.size}"

    icons = root / "apps" / "nuvio-desktop" / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    frames = [scaled(src, s) for s in ICO_SIZES]
    frames[-1].save(icons / "icon.ico", format="ICO", sizes=[(s, s) for s in ICO_SIZES], append_images=frames[:-1])
    for name, size in [("32x32.png", 32), ("64x64.png", 64), ("128x128.png", 128), ("128x128@2x.png", 256)]:
        scaled(src, size).save(icons / name, optimize=True)
    shutil.copyfile(source_path, icons / "icon.png")  # full-resolution original

    public = root / "apps" / "nuvio-desktop" / "web" / "public"
    public.mkdir(parents=True, exist_ok=True)
    scaled(src, 128).save(public / "nuvio-astra-128.png", optimize=True)
    frames_fav = [scaled(src, s) for s in (16, 32, 48)]
    frames_fav[-1].save(public / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)], append_images=frames_fav[:-1])

    # Check: every ICO frame present, transparent corners kept.
    ico = Image.open(icons / "icon.ico")
    found = sorted(ico.info["sizes"])
    assert found == sorted((s, s) for s in ICO_SIZES), found
    for s in ICO_SIZES:
        ico.size = (s, s)
        frame = ico.copy().convert("RGBA")
        assert frame.getpixel((0, 0))[3] == 0, f"{s}px corner not transparent"
    print("icon.ico:", ", ".join(f"{w}" for w, _ in found))
    print("png:", ", ".join(sorted(p.name for p in icons.glob("*.png"))))
    print("web:", ", ".join(sorted(p.name for p in public.iterdir())))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
