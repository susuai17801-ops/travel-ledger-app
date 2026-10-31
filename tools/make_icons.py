"""產生 PWA 圖示（純標準庫，不需 Pillow）：青綠底、白色硬幣＋「¥」感的圓環。"""
import struct, zlib, os, math

def png(size, path):
    cx = cy = size / 2
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            d = math.hypot(x - cx, y - cy)
            if d < size * 0.27 and d > size * 0.20:
                px = (255, 255, 255)           # 白色圓環
            elif abs(x - cx) < size * 0.035 and abs(y - cy) < size * 0.14:
                px = (255, 255, 255)           # 中間直線
            else:
                px = (15, 118, 110)            # 品牌青綠
            row += bytes(px)
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, data):
        c = struct.pack('>I', len(data)) + t + data
        return c + struct.pack('>I', zlib.crc32(t + data) & 0xffffffff)
    out = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) \
        + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(out)

here = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(here, '..', 'icons'), exist_ok=True)
for s in (192, 512):
    png(s, os.path.join(here, '..', 'icons', f'icon-{s}.png'))
print('ok')
