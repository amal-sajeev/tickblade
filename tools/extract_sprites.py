#!/usr/bin/env python3
"""
Extract character sprites from an idle animation GIF/image into spritesheets.

The source image is expected to show two characters side-by-side (blue left,
red right) on a solid green background. Each frame is split at the horizontal
midpoint, the green background is removed via chroma-key, and the characters
are stitched into horizontal spritesheets.

Outputs:
    assets/blue_idle.png   — all idle frames for the blue (P1) character
    assets/red_idle.png    — all idle frames for the red (P2) character

Usage:
    python tools/extract_sprites.py [source_image]

    If source_image is omitted the script tries the Cursor-saved JPEG first,
    then falls back to assets/idle_1x.png (which already contains both
    characters stacked vertically at 1x).
"""

import os
import sys

try:
    from PIL import Image, ImageSequence
    import numpy as np
except ImportError:
    print("ERROR: Pillow and numpy are required.  Run: pip install pillow numpy")
    sys.exit(1)


WORKSPACE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_DIR = os.path.join(WORKSPACE_ROOT, "assets")

# Cursor saves attached images here (adjust if path differs)
CURSOR_SAVED_GIF = (
    r"C:\Users\User 3\.cursor\projects\c-Games-clocksim\assets"
    r"\c__Users_User_3_AppData_Roaming_Cursor_User_workspaceStorage"
    r"_81a75437c59fbc3c6a103d16c768726a_images_Pixel_art_idle_animation"
    r"_slight_breathing_al-073426b6-64cc-494d-968f-0d2d46364e45.png"
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def green_mask(arr: np.ndarray) -> np.ndarray:
    """Return boolean mask where True = green background pixel."""
    r = arr[:, :, 0].astype(float)
    g = arr[:, :, 1].astype(float)
    b = arr[:, :, 2].astype(float)
    return (g > 80) & (g > r * 1.25) & (g > b * 1.25)


def chroma_key(img_rgba: Image.Image) -> Image.Image:
    """Return a copy of *img_rgba* with green pixels made transparent."""
    arr = np.array(img_rgba).copy()
    mask = green_mask(arr)
    arr[mask, 3] = 0
    return Image.fromarray(arr)


def tight_bbox(alpha: np.ndarray):
    """Return (rmin, rmax, cmin, cmax) for non-zero alpha rows/cols."""
    rows = np.any(alpha > 0, axis=1)
    cols = np.any(alpha > 0, axis=0)
    r_idx = np.where(rows)[0]
    c_idx = np.where(cols)[0]
    if len(r_idx) == 0 or len(c_idx) == 0:
        return None
    return int(r_idx[0]), int(r_idx[-1]), int(c_idx[0]), int(c_idx[-1])


def detect_pixel_scale(img_rgba: Image.Image) -> int:
    """
    Estimate the pixel-art upscale factor by finding the most common
    horizontal run-length of a single colour inside the character.
    Returns an integer in [1, 16]; defaults to 1 if detection fails.
    """
    arr = np.array(img_rgba)
    alpha = arr[:, :, 3]
    char_rows = np.where(np.any(alpha > 128, axis=1))[0]
    if len(char_rows) == 0:
        return 1

    run_counts: dict[int, int] = {}
    # Sample ~20 rows evenly across the character height
    sample_rows = char_rows[:: max(1, len(char_rows) // 20)]
    for row in sample_rows:
        row_rgb = arr[row, :, :3]
        row_alpha = alpha[row]
        run = 1
        for x in range(1, arr.shape[1]):
            if row_alpha[x] == 0 and row_alpha[x - 1] == 0:
                run = 1
                continue
            if np.max(np.abs(row_rgb[x].astype(int) - row_rgb[x - 1].astype(int))) < 20:
                run += 1
            else:
                if run > 1:
                    run_counts[run] = run_counts.get(run, 0) + 1
                run = 1
        if run > 1:
            run_counts[run] = run_counts.get(run, 0) + 1

    if not run_counts:
        return 1

    # Find most frequent run length that is <= 16
    best = max((v, k) for k, v in run_counts.items() if 1 < k <= 16)
    return best[1]


def normalize_frames(frames: list[Image.Image], target_w: int, target_h: int
                     ) -> list[Image.Image]:
    """Resize all frames to (target_w, target_h), bottom-aligned."""
    out = []
    for f in frames:
        canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
        ox = (target_w - f.width) // 2
        oy = target_h - f.height          # bottom-align
        canvas.paste(f, (ox, oy))
        out.append(canvas)
    return out


def build_sheet(frames: list[Image.Image]) -> Image.Image:
    """Stitch frames horizontally into a single spritesheet."""
    fw, fh = frames[0].size
    sheet = Image.new("RGBA", (fw * len(frames), fh), (0, 0, 0, 0))
    for i, frame in enumerate(frames):
        sheet.paste(frame, (i * fw, 0))
    return sheet


# ---------------------------------------------------------------------------
# Extraction from a two-character side-by-side image (JPEG / GIF)
# ---------------------------------------------------------------------------

def extract_from_animation(source_path: str):
    """Process each frame in *source_path*, splitting left/right characters."""
    src = Image.open(source_path)
    n_frames = getattr(src, "n_frames", 1)
    fmt = src.format or "unknown"
    print(f"Source : {os.path.basename(source_path)}")
    print(f"Format : {fmt}   Size : {src.size}   Frames : {n_frames}")

    frames_blue: list[Image.Image] = []
    frames_red: list[Image.Image] = []

    for i, frame in enumerate(ImageSequence.Iterator(src)):
        rgba = frame.convert("RGBA")
        w, h = rgba.size

        arr = np.array(rgba)
        bg = green_mask(arr)
        char_mask = ~bg

        # --- split at the horizontal midpoint ---
        mid = w // 2
        left_mask = char_mask[:, :mid]
        right_mask = char_mask[:, mid:]

        if not np.any(left_mask) or not np.any(right_mask):
            print(f"  Frame {i}: could not find both characters — skipped")
            continue

        # tight crop for each half
        l_bbox = tight_bbox(np.array(rgba)[:, :mid, 3] * left_mask)
        r_bbox = tight_bbox(np.array(rgba)[:, mid:, 3] * right_mask)
        if l_bbox is None or r_bbox is None:
            print(f"  Frame {i}: bounding box detection failed — skipped")
            continue

        lr0, lr1, lc0, lc1 = l_bbox
        rr0, rr1, rc0, rc1 = r_bbox

        left_crop  = rgba.crop((lc0,       lr0, lc1 + 1,       lr1 + 1))
        right_crop = rgba.crop((rc0 + mid, rr0, rc1 + mid + 1, rr1 + 1))

        left_crop  = chroma_key(left_crop)
        right_crop = chroma_key(right_crop)

        frames_blue.append(left_crop)
        frames_red.append(right_crop)
        print(f"  Frame {i}: blue {left_crop.size}  red {right_crop.size}")

    return frames_blue, frames_red


# ---------------------------------------------------------------------------
# Extraction from idle_1x.png (blue on top half, red on bottom half)
# ---------------------------------------------------------------------------

def extract_from_1x_ref() -> tuple[list[Image.Image], list[Image.Image]]:
    path = os.path.join(ASSETS_DIR, "idle_1x.png")
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    half = h // 2
    blue = img.crop((0, 0,    w, half))
    red  = img.crop((0, half, w, h))
    print(f"Fallback: {os.path.basename(path)} ({w}x{h})")
    print(f"  blue: {blue.size}   red: {red.size}")
    return [blue], [red]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(source_path: str | None = None):
    # Determine source
    if source_path and os.path.isfile(source_path):
        frames_blue, frames_red = extract_from_animation(source_path)
    elif os.path.isfile(CURSOR_SAVED_GIF):
        frames_blue, frames_red = extract_from_animation(CURSOR_SAVED_GIF)
    elif os.path.isfile(os.path.join(ASSETS_DIR, "idle_1x.png")):
        frames_blue, frames_red = extract_from_1x_ref()
    else:
        print("ERROR: No source image found.")
        print("  Tried:", CURSOR_SAVED_GIF)
        print("  And  :", os.path.join(ASSETS_DIR, "idle_1x.png"))
        sys.exit(1)

    if not frames_blue:
        print("ERROR: No frames extracted.")
        sys.exit(1)

    # Detect pixel-art scale and downscale if > 1
    scale = detect_pixel_scale(frames_blue[0])
    print(f"\nDetected pixel-art scale: {scale}x")

    if scale > 1:
        def downscale(frames, s):
            out = []
            for f in frames:
                new_w = max(1, f.width  // s)
                new_h = max(1, f.height // s)
                out.append(f.resize((new_w, new_h), Image.NEAREST))
            return out
        frames_blue = downscale(frames_blue, scale)
        frames_red  = downscale(frames_red,  scale)
        print(f"Downscaled frames to: {frames_blue[0].size}")

    # Normalize all frames to the same canvas size
    max_w = max(f.width  for f in frames_blue + frames_red)
    max_h = max(f.height for f in frames_blue + frames_red)
    frames_blue = normalize_frames(frames_blue, max_w, max_h)
    frames_red  = normalize_frames(frames_red,  max_w, max_h)

    # Build and save spritesheets
    sheet_blue = build_sheet(frames_blue)
    sheet_red  = build_sheet(frames_red)

    out_blue = os.path.join(ASSETS_DIR, "blue_idle.png")
    out_red  = os.path.join(ASSETS_DIR, "red_idle.png")
    sheet_blue.save(out_blue, "PNG")
    sheet_red.save(out_red,   "PNG")

    n = len(frames_blue)
    fw, fh = max_w, max_h

    print(f"\nSaved: {out_blue}  ({sheet_blue.width}x{sheet_blue.height})")
    print(f"Saved: {out_red}   ({sheet_red.width}x{sheet_red.height})")
    print(f"Frames : {n}   Frame size : {fw}x{fh} px (1x)")
    print()
    print("// ---- Copy these constants into sprites.js ----")
    print(f"const IDLE_FRAME_W     = {fw};")
    print(f"const IDLE_FRAME_H     = {fh};")
    print(f"const IDLE_FRAME_COUNT = {n};")
    print("// -----------------------------------------------")


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else None)
