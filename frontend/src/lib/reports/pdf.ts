import type { jsPDF as JsPdf } from 'jspdf'
import { BatchReport, formatDateTime, formatQuantity } from './model'
import { loadFontBase64 } from './download'

/**
 * PDF (ISO 32000) — A4, fonts embedded. jsPDF's 14 standard fonts are
 * Latin-1 only, so every "ầ ữ ộ" would come out as garbage; Be Vietnam Pro
 * (SIL OFL, served from /fonts) covers the full Vietnamese range and is
 * embedded in the file, so it prints identically on any machine.
 */
const FONT = 'BeVietnamPro'
const PAGE = { w: 210, h: 297 }
const MARGIN = { top: 20, bottom: 18, left: 20, right: 20 }
const CONTENT_W = PAGE.w - MARGIN.left - MARGIN.right

type Rgb = [number, number, number]
const INK: Rgb = [15, 23, 42]
const MUTED: Rgb = [100, 116, 139]
const FAINT: Rgb = [148, 163, 184]
const RULE: Rgb = [226, 232, 240]
const DANGER: Rgb = [190, 18, 60]
const OK: Rgb = [4, 120, 87]

async function registerFonts(doc: JsPdf): Promise<void> {
  const [regular, semibold] = await Promise.all([
    loadFontBase64('/fonts/BeVietnamPro-Regular.ttf'),
    loadFontBase64('/fonts/BeVietnamPro-SemiBold.ttf'),
  ])
  doc.addFileToVFS('BeVietnamPro-Regular.ttf', regular)
  doc.addFont('BeVietnamPro-Regular.ttf', FONT, 'normal')
  doc.addFileToVFS('BeVietnamPro-SemiBold.ttf', semibold)
  doc.addFont('BeVietnamPro-SemiBold.ttf', FONT, 'bold')
  doc.setFont(FONT, 'normal')
}

export async function buildBatchPdf(report: BatchReport): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  await registerFonts(doc)

  const { batch } = report
  doc.setProperties({
    title: `${report.title} — ${batch.productName}`,
    subject: `Truy xuất nguồn gốc lô ${batch.id}`,
    author: 'TraceChain',
    creator: 'TraceChain',
    keywords: `truy xuất nguồn gốc, ${batch.productType}, ${batch.origin}`,
  })
  doc.setLanguage('vi')
  doc.setDisplayMode('fullwidth', 'continuous', 'UseOutlines')

  let y = MARGIN.top
  const bottom = PAGE.h - MARGIN.bottom

  const lineHeight = (size: number) => size * 0.42
  const setText = (size: number, bold: boolean, color: Rgb) => {
    doc.setFont(FONT, bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...color)
  }
  const ensure = (needed: number) => {
    if (y + needed > bottom) {
      doc.addPage()
      y = MARGIN.top
    }
  }
  const paragraph = (text: string, opts: { size?: number; bold?: boolean; color?: Rgb; x?: number; width?: number; after?: number } = {}) => {
    const { size = 10, bold = false, color = INK, x = MARGIN.left, width = CONTENT_W, after = 1.6 } = opts
    setText(size, bold, color)
    const lines = doc.splitTextToSize(text, width) as string[]
    ensure(lines.length * lineHeight(size))
    doc.text(lines, x, y, { baseline: 'top' })
    y += lines.length * lineHeight(size) + after
  }
  const rule = (after = 4) => {
    ensure(2)
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.2)
    doc.line(MARGIN.left, y, PAGE.w - MARGIN.right, y)
    y += after
  }
  /** Two-column label/value block — labels aligned, values wrapping. */
  const keyValues = (rows: Array<[string, string, Rgb?]>) => {
    const labelW = 38
    for (const [label, value, color] of rows) {
      setText(9.5, false, MUTED)
      const valueLines = (() => {
        setText(9.5, false, color ?? INK)
        return doc.splitTextToSize(value, CONTENT_W - labelW) as string[]
      })()
      const h = valueLines.length * lineHeight(9.5)
      ensure(h)
      setText(9.5, false, MUTED)
      doc.text(label, MARGIN.left, y, { baseline: 'top' })
      setText(9.5, false, color ?? INK)
      doc.text(valueLines, MARGIN.left + labelW, y, { baseline: 'top' })
      y += h + 1.4
    }
  }

  // ── Heading ──
  paragraph(report.title.toUpperCase(), { size: 15, bold: true, after: 1 })
  paragraph(`Xuất lúc ${formatDateTime(report.generatedAt)} · Hệ thống TraceChain`, { size: 8.5, color: MUTED, after: 4 })
  rule()

  // ── Batch ──
  paragraph(batch.productName, { size: 12.5, bold: true, after: 2.5 })
  keyValues([
    ['Loại sản phẩm', batch.productType],
    ['Xuất xứ', batch.origin],
    ['Số lượng', `${formatQuantity(batch.quantity)} ${batch.unit}`],
    ['Ngày tạo lô', formatDateTime(new Date(batch.createdAt))],
    ['Trạng thái', report.statusText, batch.isRecalled ? DANGER : undefined],
    ['Toàn vẹn dữ liệu', report.integrityText, report.isValid ? OK : DANGER],
    ['Mã lô', batch.id],
    ['Tra cứu công khai', report.publicUrl],
  ])
  y += 2
  rule()

  // ── Journey ──
  paragraph(`HÀNH TRÌNH (${report.steps.length} KHÂU)`, { size: 10.5, bold: true, after: 3 })
  if (report.steps.length === 0) paragraph('Chưa có khâu nào được ghi nhận.', { color: MUTED })

  const indent = 8
  for (const step of report.steps) {
    ensure(22)
    // Step header bar
    doc.setFillColor(241, 245, 249)
    doc.roundedRect(MARGIN.left, y - 1, CONTENT_W, 7, 1, 1, 'F')
    setText(10, true, INK)
    doc.text(`${step.index}. ${step.stageLabel}`, MARGIN.left + 2, y + 0.4, { baseline: 'top' })
    setText(9, false, MUTED)
    doc.text(formatDateTime(step.time), PAGE.w - MARGIN.right - 2, y + 0.6, { baseline: 'top', align: 'right' })
    y += 8

    const who = [step.organization, step.person && `${step.person}${step.role ? ` (${step.role})` : ''}`].filter(Boolean).join(' · ')
    paragraph(`Thực hiện: ${who}`, { size: 9.5, x: MARGIN.left + indent, width: CONTENT_W - indent, after: 0.8 })
    paragraph(`Địa điểm: ${step.location}`, { size: 9.5, x: MARGIN.left + indent, width: CONTENT_W - indent, after: 0.8 })
    if (step.facts.length > 0) {
      paragraph(step.facts.map((f) => `${f.label}: ${f.value}`).join('  ·  '), {
        size: 9.5,
        x: MARGIN.left + indent,
        width: CONTENT_W - indent,
        after: 0.8,
      })
    }
    if (step.notes) paragraph(`Ghi chú: ${step.notes}`, { size: 9.5, color: MUTED, x: MARGIN.left + indent, width: CONTENT_W - indent, after: 0.8 })
    paragraph(`SHA-256: ${step.hash}`, { size: 7, color: FAINT, x: MARGIN.left + indent, width: CONTENT_W - indent, after: 4 })
  }

  // ── Anomalies ──
  if (report.anomalies.length > 0) {
    rule()
    paragraph(`CẢNH BÁO BẤT THƯỜNG (${report.anomalies.length})`, { size: 10.5, bold: true, after: 3 })
    for (const a of report.anomalies) {
      paragraph(`• [${a.severity}] ${a.message} — ${formatDateTime(a.detectedAt)}${a.resolved ? ' (đã xử lý)' : ''}`, {
        size: 9.5,
        after: 1.2,
      })
    }
  }

  // ── Footer on every page ──
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setDrawColor(...RULE)
    doc.line(MARGIN.left, PAGE.h - 12, PAGE.w - MARGIN.right, PAGE.h - 12)
    setText(7.5, false, FAINT)
    doc.text(`${batch.productName} · Mã lô ${batch.id.slice(0, 8)}`, MARGIN.left, PAGE.h - 9, { baseline: 'top' })
    doc.text(`Trang ${p}/${pages}`, PAGE.w - MARGIN.right, PAGE.h - 9, { baseline: 'top', align: 'right' })
  }

  return doc.output('blob')
}
