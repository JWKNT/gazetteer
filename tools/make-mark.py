"""Render assets/mark.svg to the masthead mark and favicon.

Follows site-theme/tools/make_symbols.py: a 128px transparent black mark and a
192px favicon with a white symbol on a rounded black field. Requires rsvg-convert
(librsvg) and Pillow. Run: python3 tools/make-mark.py
"""
from pathlib import Path
import subprocess
import tempfile

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]


def generate():
    with tempfile.TemporaryDirectory() as temp:
        raster = Path(temp) / "mark.png"
        subprocess.run(["rsvg-convert", "--width=768", "--height=768", "--output", str(raster),
                        str(ROOT / "assets/mark.svg")], check=True)
        alpha = Image.open(raster).convert("RGBA").getchannel("A")
        mark = Image.new("RGBA", (128, 128), "black")
        mark.putalpha(alpha.resize((128, 128), Image.Resampling.LANCZOS))
        mark.save(ROOT / "assets/mark.png", optimize=True)
        favicon = Image.new("RGBA", (768, 768), (0, 0, 0, 0))
        ImageDraw.Draw(favicon).rounded_rectangle((24, 24, 744, 744), radius=112, fill="black")
        symbol = Image.new("RGBA", (576, 576), "white")
        symbol.putalpha(alpha.resize((576, 576), Image.Resampling.LANCZOS))
        favicon.alpha_composite(symbol, (96, 96))
        favicon.resize((192, 192), Image.Resampling.LANCZOS).save(ROOT / "assets/favicon.png", optimize=True)


if __name__ == "__main__":
    generate()
