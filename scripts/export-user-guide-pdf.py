from __future__ import annotations

import html
import re
from pathlib import Path

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable, Image, KeepTogether, ListFlowable, ListItem, Paragraph,
    SimpleDocTemplate, Spacer, Table, TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/user-guide.md'
OUTPUT = ROOT / 'output/pdf/冒泡用户说明书.pdf'
FONT = 'MaopaoCN'
PURPLE = colors.HexColor('#7462E7')
INK = colors.HexColor('#252936')
MUTED = colors.HexColor('#687083')
LINE = colors.HexColor('#E2E5EC')
SOFT = colors.HexColor('#F5F4FC')

pdfmetrics.registerFont(TTFont(FONT, '/System/Library/Fonts/STHeiti Light.ttc'))

base = getSampleStyleSheet()['BodyText']
body = ParagraphStyle('body', parent=base, fontName=FONT, fontSize=9.5, leading=15, textColor=INK, spaceAfter=5, wordWrap='CJK')
styles = {
    1: ParagraphStyle('h1', parent=body, fontSize=26, leading=34, textColor=PURPLE, alignment=TA_CENTER, spaceBefore=42*mm, spaceAfter=8*mm),
    2: ParagraphStyle('h2', parent=body, fontSize=17, leading=23, spaceBefore=7*mm, spaceAfter=3*mm, keepWithNext=True),
    3: ParagraphStyle('h3', parent=body, fontSize=12.5, leading=18, textColor=PURPLE, spaceBefore=3.5*mm, spaceAfter=1.5*mm, keepWithNext=True),
    4: ParagraphStyle('h4', parent=body, fontSize=10.5, leading=16, spaceBefore=3*mm, spaceAfter=2*mm, keepWithNext=True),
}
meta = ParagraphStyle('meta', parent=body, fontSize=10, leading=17, alignment=TA_CENTER, textColor=MUTED, spaceAfter=1.5*mm)
caption = ParagraphStyle('caption', parent=body, fontSize=8, leading=11, alignment=TA_CENTER, textColor=MUTED, spaceBefore=2*mm, spaceAfter=5*mm)
quote = ParagraphStyle('quote', parent=body, leftIndent=6*mm, rightIndent=4*mm, borderPadding=7, backColor=SOFT, textColor=colors.HexColor('#514D68'), spaceAfter=4*mm)
code = ParagraphStyle('code', parent=body, fontName='Courier', fontSize=8.5, leading=13, leftIndent=5*mm, rightIndent=5*mm, borderPadding=7, backColor=colors.HexColor('#F3F4F7'), textColor=colors.HexColor('#3F4452'), spaceAfter=4*mm)
list_text = ParagraphStyle('list', parent=body, spaceAfter=1)
table_header = ParagraphStyle('table-header', parent=body, fontSize=8.5, leading=12, textColor=colors.white)
table_cell = ParagraphStyle('table-cell', parent=body, fontSize=8.2, leading=12, spaceAfter=0)


def inline(value: str) -> str:
    held: list[str] = []

    def keep(markup: str) -> str:
        held.append(markup)
        return f'\0{len(held)-1}\0'

    value = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', lambda m: keep(f'<link href="{html.escape(m.group(2), quote=True)}" color="#6654D9">{html.escape(m.group(1))}</link>'), value)
    value = re.sub(r'`([^`]+)`', lambda m: keep(f'<font name="Courier" color="#4E4A75">{html.escape(m.group(1))}</font>'), value)
    value = re.sub(r'\*\*([^*]+)\*\*', lambda m: keep(f'<b>{html.escape(m.group(1))}</b>'), value)
    value = html.escape(value)
    for index, markup in enumerate(held):
        value = value.replace(f'\0{index}\0', markup)
    return value


def screenshot(path: Path, label: str):
    with PILImage.open(path) as image:
        width, height = image.size
    natural_w, natural_h = width * .72, height * .72
    scale = min(1, 158*mm/natural_w, 116*mm/natural_h)
    return KeepTogether([
        Spacer(1, 2*mm),
        Image(str(path), width=natural_w*scale, height=natural_h*scale, hAlign='CENTER'),
        Paragraph(inline(label), caption),
    ])


def table(rows: list[list[str]]):
    columns = max(map(len, rows))
    data = []
    for row_index, row in enumerate(rows):
        style = table_header if row_index == 0 else table_cell
        data.append([Paragraph(inline(cell), style) for cell in row + ['']*(columns-len(row))])
    result = Table(data, colWidths=[174*mm/columns]*columns, repeatRows=1, hAlign='LEFT')
    result.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PURPLE), ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F8F8FB')]),
        ('GRID', (0, 0), (-1, -1), .45, LINE), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 7), ('RIGHTPADDING', (0, 0), (-1, -1), 7),
        ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    return result


def parse_markdown(text: str):
    lines, story, index = text.splitlines(), [], 0
    while index < len(lines):
        value = lines[index].strip()
        if not value:
            index += 1
            continue
        if value.startswith('```'):
            block = []
            index += 1
            while index < len(lines) and not lines[index].strip().startswith('```'):
                block.append(lines[index]); index += 1
            story.append(Paragraph('<br/>'.join(html.escape(line) for line in block), code)); index += 1
            continue
        image_match = re.fullmatch(r'!\[([^\]]*)\]\(([^)]+)\)', value)
        if image_match:
            story.append(screenshot(SOURCE.parent/image_match.group(2), image_match.group(1))); index += 1
            continue
        if value == '---':
            story.extend([Spacer(1, 2*mm), HRFlowable(width='100%', thickness=.6, color=LINE, spaceAfter=3*mm)]); index += 1
            continue
        if value.startswith('|') and index+1 < len(lines) and re.match(r'^\s*\|?\s*:?-+', lines[index+1]):
            rows = [[cell.strip() for cell in value.strip('|').split('|')]]; index += 2
            while index < len(lines) and lines[index].strip().startswith('|'):
                rows.append([cell.strip() for cell in lines[index].strip().strip('|').split('|')]); index += 1
            story.extend([table(rows), Spacer(1, 3*mm)]); continue
        heading = re.match(r'^(#{1,4})\s+(.+)$', value)
        if heading:
            story.append(Paragraph(inline(heading.group(2)), styles[len(heading.group(1))])); index += 1
            continue
        if value.startswith('>'):
            story.append(Paragraph(inline(value[1:].strip()), quote)); index += 1
            continue
        if re.match(r'^[-*]\s+', value):
            items = []
            while index < len(lines) and re.match(r'^\s*[-*]\s+', lines[index]):
                item = re.sub(r'^\s*[-*]\s+', '', lines[index]).strip()
                items.append(ListItem(Paragraph(inline(item), list_text), leftIndent=4*mm)); index += 1
            story.append(ListFlowable(items, bulletType='bullet', bulletFontName=FONT, bulletFontSize=7, leftIndent=5*mm, bulletColor=PURPLE, spaceAfter=3*mm)); continue
        if re.match(r'^\d+\.\s+', value):
            items = []
            while index < len(lines) and re.match(r'^\s*\d+\.\s+', lines[index]):
                item = re.sub(r'^\s*\d+\.\s+', '', lines[index]).strip()
                items.append(ListItem(Paragraph(inline(item), list_text), leftIndent=6*mm)); index += 1
            story.append(ListFlowable(items, bulletType='1', bulletFontName=FONT, bulletFontSize=8.5, leftIndent=7*mm, bulletColor=PURPLE, spaceAfter=3*mm)); continue
        paragraph = [value]; index += 1
        while index < len(lines):
            following = lines[index].strip()
            if not following or re.match(r'^(#{1,4})\s+|^[-*]\s+|^\d+\.\s+|^>|^```|^---$|^!\[|^\|', following):
                break
            paragraph.append(following); index += 1
        combined = ' '.join(paragraph)
        style = meta if len(story) < 6 and combined.startswith(('版本：', '适用对象：', '最后更新：')) else body
        story.append(Paragraph(inline(combined), style))
    return story


def later_page(canvas, document):
    canvas.saveState()
    canvas.setStrokeColor(LINE); canvas.setLineWidth(.5)
    canvas.line(document.leftMargin, A4[1]-12*mm, A4[0]-document.rightMargin, A4[1]-12*mm)
    canvas.setFont(FONT, 8); canvas.setFillColor(MUTED)
    canvas.drawString(document.leftMargin, A4[1]-9*mm, '冒泡 · 用户说明书')
    canvas.drawRightString(A4[0]-document.rightMargin, 9*mm, str(document.page))
    canvas.restoreState()


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    document = SimpleDocTemplate(
        str(OUTPUT), pagesize=A4, leftMargin=18*mm, rightMargin=18*mm, topMargin=18*mm, bottomMargin=17*mm,
        title='冒泡用户说明书', author='冒泡', subject='桌面办公与开发工具箱完整用户说明',
    )
    document.build(parse_markdown(SOURCE.read_text(encoding='utf-8')), onLaterPages=later_page)
    print(OUTPUT)


if __name__ == '__main__':
    main()
