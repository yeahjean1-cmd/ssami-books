"""E2E용 원고 파일(TXT·DOCX·HWPX)을 만든다. 사용: python3 make-fixtures.py <폴더>"""
import io, struct, sys, zipfile, zlib
from pathlib import Path

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
para = '아침 공기가 차가웠다. 그는 “조금만 더 걸어 볼까?” 하고 혼잣말을 했다. 길은 생각보다 길었고(정말로 길었다), 발걸음은 생각보다 가벼웠다. '
names = ['프롤로그', '제1장 골목의 아침', '제2장 강을 따라', '제3장 오래된 서점', '제4장 돌아오는 길', '에필로그']

lines = []
for ci, name in enumerate(names):
    lines += [name, '']
    for i in range(18):
        if i == 6: lines.append('## 잠시 멈춤')
        if i == 10: lines.append('> 걷는다는 것은 생각한다는 것이다.')
        lines.append(para * (1 + (i * 7 + ci) % 5))
    lines.append('')
(out / 'manuscript.txt').write_text('\n'.join(lines), encoding='utf-8')

def png(w, h):
    raw = b''.join(b'\x00' + bytes([120, 140, 115]) * w for _ in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')

from docx import Document
from docx.shared import Mm
d = Document()
d.add_heading('여는 글', level=1)
p = d.add_paragraph('이 책은 '); p.add_run('천천히 걷는 사람').bold = True; p.add_run('에 관한 기록이다. ' + para)
d.add_paragraph(para * 3)
d.add_picture(io.BytesIO(png(600, 400)), width=Mm(100))
d.add_heading('강가에서', level=1)
d.add_heading('첫 번째 다리', level=2)
for i in range(6): d.add_paragraph(para * (2 + i % 3))
t = d.add_table(rows=2, cols=2)
for r in range(2):
    for c in range(2): t.cell(r, c).text = f'칸 {r + 1}-{c + 1}'
d.add_paragraph('첫째 항목', style='List Bullet')
d.save(out / 'manuscript.docx')

ns = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"'
def hp(text, style=0, inner=''):
    return f'<hp:p id="0" paraPrIDRef="0" styleIDRef="{style}"><hp:run charPrIDRef="0"><hp:t>{text}</hp:t>{inner}</hp:run></hp:p>'
table = '<hp:tbl><hp:tr><hp:tc><hp:subList>' + hp('표 안의 글') + '</hp:subList></hp:tc></hp:tr></hp:tbl>'
body = hp('한글 문서의 시작', 1) + hp(para * 2) + hp('둘째 마디', 2) + hp('표가 있는 문단', 0, table) + hp(para)
with zipfile.ZipFile(out / 'manuscript.hwpx', 'w') as z:
    z.writestr('mimetype', 'application/hwp+zip')
    z.writestr('Contents/header.xml', f'<?xml version="1.0" encoding="UTF-8"?><hh:head {ns}><hh:refList><hh:styles itemCnt="3">'
               '<hh:style id="0" type="PARA" name="바탕글"/><hh:style id="1" type="PARA" name="개요 1"/><hh:style id="2" type="PARA" name="개요 2"/>'
               '</hh:styles></hh:refList></hh:head>')
    z.writestr('Contents/section0.xml', f'<?xml version="1.0" encoding="UTF-8"?><hs:sec {ns}>{body}</hs:sec>')
print('fixtures ok')
