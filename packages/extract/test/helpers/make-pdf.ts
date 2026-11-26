/**
 * Builds small PDFs byte by byte for tests. Japanese text uses a non-embedded Type0 font with the
 * predefined CMap UniJIS-UTF16-H (Adobe-Japan1), which is exactly the case that needs pdf.js CMaps.
 */

function utf16beHex(s: string): string {
  let out = ''
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number
    if (cp > 0xffff) {
      const v = cp - 0x10000
      out +=
        (0xd800 + (v >> 10)).toString(16).padStart(4, '0') +
        (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0')
    } else out += cp.toString(16).padStart(4, '0')
  }
  return out.toUpperCase()
}

export interface PdfLine {
  text: string
  font: 'jp' | 'latin'
  size: number
  x: number
  y: number
}

function contentStream(lines: PdfLine[]): string {
  return lines
    .map((l) => {
      const str =
        l.font === 'jp' ? `<${utf16beHex(l.text)}>` : `(${l.text.replace(/[\\()]/g, '\\$&')})`
      return `BT /${l.font === 'jp' ? 'F1' : 'F2'} ${l.size} Tf ${l.x} ${l.y} Td ${str} Tj ET`
    })
    .join('\n')
}

/** Each page is a list of text lines, or the string 'image-only' for a page with drawing but no text. */
export function makePdf(
  pages: (PdfLine[] | 'image-only')[],
  info: { title?: string } = {},
): Uint8Array {
  const objects: string[] = []
  const add = (body: string) => {
    objects.push(body)
    return objects.length
  }
  const catalog = add('')
  const pagesObj = add('')
  const descriptor = add(
    '<< /Type /FontDescriptor /FontName /KozMinPr6N-Regular /Flags 4 /FontBBox [-437 -340 1147 1317] /ItalicAngle 0 /Ascent 1317 /Descent -349 /CapHeight 742 /StemV 80 >>',
  )
  const cidFont = add(
    `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /KozMinPr6N-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> /FontDescriptor ${descriptor} 0 R /DW 1000 >>`,
  )
  const fontJp = add(
    `<< /Type /Font /Subtype /Type0 /BaseFont /KozMinPr6N-Regular /Encoding /UniJIS-UTF16-H /DescendantFonts [${cidFont} 0 R] >>`,
  )
  const fontLatin = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  )
  const kids: number[] = []
  for (const page of pages) {
    const stream =
      page === 'image-only' ? '0.2 0.4 0.8 rg 72 300 400 300 re f' : contentStream(page)
    const content = add(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    )
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontJp} 0 R /F2 ${fontLatin} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    )
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R /Lang (ja) >>`
  objects[pagesObj - 1] =
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  const infoObj = info.title ? add(`<< /Title <FEFF${utf16beHex(info.title)}> >>`) : null

  let pdf = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${infoObj ? ` /Info ${infoObj} 0 R` : ''} >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(pdf, 'latin1'))
}
