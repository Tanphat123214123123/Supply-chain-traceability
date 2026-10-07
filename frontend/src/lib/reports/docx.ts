import type { Paragraph as ParagraphT, Table as TableT } from 'docx'
import { BatchReport, formatDateTime, formatQuantity } from './model'

/**
 * Word report as real .docx (Office Open XML, ECMA-376 / ISO/IEC 29500),
 * laid out per Vietnamese administrative-document conventions (Nghị định
 * 30/2020/NĐ-CP): A4 portrait, Times New Roman 13 pt body, margins top/bottom
 * 20 mm, left 30 mm, right 15 mm. Times New Roman ships with every Windows and
 * macOS install and covers Vietnamese fully, so nothing needs embedding and
 * the file opens identically in Word, LibreOffice and Google Docs. The text
 * language is tagged vi-VN so spell-check and screen readers behave.
 */

const FONT = 'Times New Roman'
const pt = (n: number) => n * 2 // docx measures font size in half-points
const PAGE_MM = { w: 210, h: 297, top: 20, bottom: 20, left: 30, right: 15 }
/** mm → twips (1/1440 inch), rounded — docx's own helper floors, giving 11905 × 16837 instead of Word's A4 11906 × 16838. */
const mm = (v: number) => Math.round((v * 1440) / 25.4)

export async function buildBatchDocx(report: BatchReport): Promise<Blob> {
  const d = await import('docx')
  const {
    AlignmentType,
    BorderStyle,
    Document,
    Footer,
    Header,
    HeadingLevel,
    Packer,
    PageNumber,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    VerticalAlign,
    WidthType,
  } = d

  const { batch } = report
  const contentWidth = mm(PAGE_MM.w - PAGE_MM.left - PAGE_MM.right)

  const text = (value: string, opts: { bold?: boolean; italics?: boolean; size?: number; color?: string; font?: string } = {}) =>
    new TextRun({ text: value, bold: opts.bold, italics: opts.italics, size: opts.size ? pt(opts.size) : undefined, color: opts.color, font: opts.font })

  const para = (runs: string | ReturnType<typeof text>[], opts: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number; size?: number; bold?: boolean } = {}) =>
    new Paragraph({
      alignment: opts.align,
      spacing: { after: opts.after ?? 60 },
      children: typeof runs === 'string' ? [text(runs, { size: opts.size, bold: opts.bold })] : runs,
    })

  const heading = (value: string) =>
    new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 }, children: [text(value, { bold: true, size: 13 })] })

  const border = { style: BorderStyle.SINGLE, size: 4, color: 'A0AEC0' }
  const borders = { top: border, bottom: border, left: border, right: border }

  const cell = (children: ParagraphT[] | string, opts: { width: number; header?: boolean; shade?: string } = { width: 1 }) =>
    new TableCell({
      width: { size: opts.width, type: WidthType.DXA },
      borders,
      verticalAlign: VerticalAlign.TOP,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      shading: opts.header || opts.shade ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.header ? 'E2E8F0' : opts.shade! } : undefined,
      children: typeof children === 'string' ? [para([text(children, { size: 12, bold: opts.header })], { after: 0 })] : children,
    })

  const table = (widthsMm: number[], header: string[] | null, rows: Array<Array<ParagraphT[] | string>>): TableT => {
    const widths = widthsMm.map(mm)
    return new Table({
      width: { size: contentWidth, type: WidthType.DXA },
      columnWidths: widths,
      rows: [
        ...(header ? [new TableRow({ tableHeader: true, cantSplit: true, children: header.map((h, i) => cell(h, { width: widths[i], header: true })) })] : []),
        ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, { width: widths[i] })) })),
      ],
    })
  }

  const lines = (values: string[], size = 12) =>
    values.filter(Boolean).map((v) => new Paragraph({ spacing: { after: 0 }, children: [text(v, { size })] }))

  // ── I. Batch information ──
  const infoRows: Array<[string, string]> = [
    ['Sản phẩm', batch.productName],
    ['Loại sản phẩm', batch.productType],
    ['Xuất xứ', batch.origin],
    ['Số lượng', `${formatQuantity(batch.quantity)} ${batch.unit}`],
    ['Ngày tạo lô', formatDateTime(new Date(batch.createdAt))],
    ['Trạng thái', report.statusText],
    ['Toàn vẹn dữ liệu', report.integrityText],
    ['Mã lô', batch.id],
    ['Tra cứu công khai', report.publicUrl],
  ]

  // ── II. Journey ──
  const journeyRows = report.steps.map((s) => [
    String(s.index),
    lines([s.stageLabel, formatDateTime(s.time)]),
    lines([s.organization, s.person && `${s.person}${s.role ? ` (${s.role})` : ''}`]),
    s.location,
    lines([...s.facts.map((f) => `${f.label}: ${f.value}`), s.notes && `Ghi chú: ${s.notes}`]),
  ])

  const children: Array<ParagraphT | TableT> = [
    para([text('BÁO CÁO HÀNH TRÌNH LÔ HÀNG', { bold: true, size: 14 })], { align: AlignmentType.CENTER, after: 40 }),
    para([text(`Xuất lúc ${formatDateTime(report.generatedAt)}`, { italics: true, size: 12 })], { align: AlignmentType.CENTER, after: 240 }),

    heading('I. THÔNG TIN LÔ HÀNG'),
    table([45, 120], null, infoRows.map(([k, v]) => [[para([text(k, { size: 12, bold: true })], { after: 0 })], v])),

    heading(`II. HÀNH TRÌNH (${report.steps.length} KHÂU)`),
    report.steps.length > 0
      ? table([12, 33, 40, 35, 45], ['STT', 'Khâu / Thời gian', 'Thực hiện', 'Địa điểm', 'Thông tin khâu'], journeyRows)
      : para('Chưa có khâu nào được ghi nhận.'),
  ]

  if (report.anomalies.length > 0) {
    children.push(
      heading(`III. CẢNH BÁO BẤT THƯỜNG (${report.anomalies.length})`),
      table(
        [25, 90, 30, 20],
        ['Mức độ', 'Nội dung', 'Phát hiện lúc', 'Trạng thái'],
        report.anomalies.map((a) => [a.severity, a.message, formatDateTime(a.detectedAt), a.resolved ? 'Đã xử lý' : 'Chưa xử lý']),
      ),
    )
  }

  // Appendix: the hashes, for anyone re-verifying the chain by hand.
  if (report.steps.length > 0) {
    children.push(
      heading(`${report.anomalies.length > 0 ? 'IV' : 'III'}. PHỤ LỤC — MÃ BĂM SHA-256`),
      table(
        [12, 33, 120],
        ['STT', 'Khâu', 'Mã băm'],
        report.steps.map((s) => [String(s.index), s.stageLabel, [para([text(s.hash, { size: 9, font: 'Courier New' })], { after: 0 })]]),
      ),
    )
  }

  const doc = new Document({
    creator: 'TraceChain',
    lastModifiedBy: 'TraceChain',
    title: `${report.title} — ${batch.productName}`,
    subject: `Truy xuất nguồn gốc lô ${batch.id}`,
    description: report.statusText,
    keywords: `truy xuất nguồn gốc, ${batch.productType}, ${batch.origin}`,
    styles: {
      default: {
        document: { run: { font: FONT, size: pt(13), language: { value: 'vi-VN' } }, paragraph: { spacing: { line: 276 } } },
        heading2: { run: { font: FONT, size: pt(13), bold: true, color: '000000' } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: mm(PAGE_MM.w), height: mm(PAGE_MM.h) },
            margin: { top: mm(PAGE_MM.top), bottom: mm(PAGE_MM.bottom), left: mm(PAGE_MM.left), right: mm(PAGE_MM.right), header: mm(10), footer: mm(10) },
          },
        },
        headers: {
          default: new Header({
            children: [para([text(`TraceChain — ${batch.productName}`, { size: 10, italics: true, color: '64748B' })], { align: AlignmentType.RIGHT, after: 0 })],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ size: pt(10), children: ['Trang ', PageNumber.CURRENT, '/', PageNumber.TOTAL_PAGES] })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  })

  return Packer.toBlob(doc)
}
