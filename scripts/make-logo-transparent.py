#!/usr/bin/env python3
"""Key the cream background out of the Marpin logo PNG and auto-crop to the mark.

Pure stdlib (zlib only) — decodes the source RGB PNG, makes near-cream pixels
transparent with a soft edge, crops to the non-transparent bounding box, and
re-encodes a tight RGBA PNG to public/marpin-logo.png.
"""
import struct
import zlib
import sys

SRC = "assets/ChatGPT Image 23 jun 2026, 12_33_16 (2).png"
OUT = "public/marpin-logo.png"


def read_png_rgb(path):
    with open(path, "rb") as f:
        data = f.read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos = 8
    width = height = bit_depth = color_type = interlace = None
    idat = bytearray()
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        ctype = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        pos += 12 + length  # length + type + data + crc
        if ctype == b"IHDR":
            width, height, bit_depth, color_type, _comp, _filt, interlace = struct.unpack(
                ">IIBBBBB", body
            )
        elif ctype == b"IDAT":
            idat += body
        elif ctype == b"IEND":
            break
    assert bit_depth == 8 and color_type == 2 and interlace == 0, (
        f"expected 8-bit non-interlaced RGB, got depth={bit_depth} type={color_type} interlace={interlace}"
    )
    raw = zlib.decompress(bytes(idat))
    bpp = 3
    stride = width * bpp
    out = bytearray(stride * height)
    prev = bytearray(stride)
    p = 0
    for y in range(height):
        ftype = raw[p]
        p += 1
        line = bytearray(raw[p : p + stride])
        p += stride
        if ftype == 1:  # Sub
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif ftype == 2:  # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:  # Average
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:  # Paeth
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out[y * stride : y * stride + stride] = line
        prev = line
    return width, height, bytes(out)


def keyed_rgba(width, height, rgb):
    # Background cream sampled from the corner.
    br, bg, bb = rgb[0], rgb[1], rgb[2]
    lo, hi = 45.0, 95.0  # soft alpha ramp by distance from the bg color
    rgba = bytearray(width * height * 4)
    for i in range(width * height):
        r = rgb[i * 3]
        g = rgb[i * 3 + 1]
        b = rgb[i * 3 + 2]
        d = ((r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2) ** 0.5
        if d <= lo:
            a = 0
        elif d >= hi:
            a = 255
        else:
            a = int(round((d - lo) / (hi - lo) * 255))
        o = i * 4
        rgba[o] = r
        rgba[o + 1] = g
        rgba[o + 2] = b
        rgba[o + 3] = a
    return rgba


def crop_to_content(width, height, rgba, pad_frac=0.06):
    minx, miny, maxx, maxy = width, height, -1, -1
    for y in range(height):
        row = y * width * 4
        for x in range(width):
            if rgba[row + x * 4 + 3] > 16:
                if x < minx:
                    minx = x
                if x > maxx:
                    maxx = x
                if y < miny:
                    miny = y
                if y > maxy:
                    maxy = y
    if maxx < 0:
        return width, height, rgba
    # square the crop around the mark + a little padding
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    half = max(maxx - minx, maxy - miny) / 2
    half *= 1 + pad_frac
    nminx = max(0, int(cx - half))
    nminy = max(0, int(cy - half))
    nmaxx = min(width - 1, int(cx + half))
    nmaxy = min(height - 1, int(cy + half))
    nw, nh = nmaxx - nminx + 1, nmaxy - nminy + 1
    out = bytearray(nw * nh * 4)
    for y in range(nh):
        src = ((nminy + y) * width + nminx) * 4
        dst = y * nw * 4
        out[dst : dst + nw * 4] = rgba[src : src + nw * 4]
    return nw, nh, out


def write_png_rgba(path, width, height, rgba):
    stride = width * 4
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: none
        raw += rgba[y * stride : y * stride + stride]
    comp = zlib.compress(bytes(raw), 9)

    def chunk(tag, body):
        return (
            struct.pack(">I", len(body))
            + tag
            + body
            + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", comp))
        f.write(chunk(b"IEND", b""))


def main():
    w, h, rgb = read_png_rgb(SRC)
    rgba = keyed_rgba(w, h, rgb)
    nw, nh, cropped = crop_to_content(w, h, rgba)
    write_png_rgba(OUT, nw, nh, cropped)
    import os

    print(f"source {w}x{h} -> cropped {nw}x{nh}; wrote {OUT} ({os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    sys.exit(main())
