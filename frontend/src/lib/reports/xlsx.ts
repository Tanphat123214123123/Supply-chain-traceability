import type { Workbook, Worksheet } from 'exceljs'
import { Batch, STAGE_LABELS } from '../../api/client'
import { batchStatusText, BatchReport, formatDateTime } from './model'

/**
 * Excel workbooks as real .xlsx (Office Open XML, ECMA-376 / ISO/IEC 29500)
 * rather than CSV. CSV was the root of the "broken Excel file" reports: Excel
 * on Windows set to Vietnamese uses ";" as list separator, so a comma CSV
 * lands in one column, and dates/quantities arrive as text. Here every cell
 * carries its type — dates are date cells, quantities numbers — with explicit
 * number formats, a frozen header and filters.
 */

const DATE_TIME_FMT = 'dd/mm/yyyy hh:mm'
const QTY_FMT = '#,##0.###'
const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1E293B' } }
const FONT = { name: 'Calibri', size: 11 }

/**
 * Excel stores date-times without a zone and ExcelJS writes a Date's UTC
 * value — so a 21:20 (UTC+7) event would display as 14:20. Shift by the
 * local offset so the cell shows the wall-clock time the user saw in the app.
 */
export function excelLocalDate(d: Date): Date {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
}

async function newWorkbook(title: string): Promise<Workbook> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'TraceChain'
  wb.lastModifiedBy = 'TraceChain'
  wb.title = title
  wb.company = 'TraceChain'
  wb.created = new Date()
  wb.modified = new Date()
  return wb
}

/** A typed table: bold white header, frozen, auto-filtered, sized columns. */
function addTable(
  ws: Worksheet,
  columns: Array<{ header: string; key: string; width: number; numFmt?: string; wrap?: boolean }>,
  rows: Array<Record<string, unknown>>,
): void {
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }))
  const header = ws.getRow(1)
  header.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = HEADER_FILL
  header.alignment = { vertical: 'middle', wrapText: true }
  header.height = 22
  for (const row of rows) ws.addRow(row)
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    if (c.numFmt) col.numFmt = c.numFmt
    col.alignment = { vertical: 'top', wrapText: c.wrap ?? false }
  })
  ws.getRow(1).alignment = { vertical: 'middle', wrapText: true }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  if (rows.length > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      cell.font = { ...FONT, ...(cell.font ?? {}) }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } }
    })
  })
}

function keyValueSheet(ws: Worksheet, rows: Array<[string, string | number | Date, string?]>): void {
  ws.columns = [
    { key: 'k', width: 24 },
    { key: 'v', width: 70 },
  ]
  for (const [k, v, fmt] of rows) {
    const row = ws.addRow({ k, v })
    row.getCell(1).font = { ...FONT, bold: true, color: { argb: 'FF475569' } }
    row.getCell(2).font = FONT
    row.getCell(2).alignment = { wrapText: true, vertical: 'top', horizontal: 'left' }
    if (fmt) row.getCell(2).numFmt = fmt
  }
}

async function toBlob(wb: Workbook): Promise<Blob> {
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export async function buildBatchXlsx(report: BatchReport): Promise<Blob> {
  const { batch } = report
  const wb = await newWorkbook(`${report.title} — ${batch.productName}`)

  keyValueSheet(wb.addWorksheet('Thông tin lô', { pageSetup: { paperSize: 9, orientation: 'portrait' } }), [
    ['Sản phẩm', batch.productName],
    ['Loại', batch.productType],
    ['Xuất xứ', batch.origin],
    ['Số lượng', batch.quantity, QTY_FMT],
    ['Đơn vị', batch.unit],
    ['Ngày tạo lô', excelLocalDate(new Date(batch.createdAt)), DATE_TIME_FMT],
    ['Trạng thái', report.statusText],
    ['Toàn vẹn dữ liệu', report.integrityText],
    ['Mã lô', batch.id],
    ['Tra cứu công khai', report.publicUrl],
    ['Xuất lúc', excelLocalDate(report.generatedAt), DATE_TIME_FMT],
  ])

  // Landscape A4, header row repeated on every printed page.
  const journey = wb.addWorksheet('Hành trình', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' },
  })
  addTable(
    journey,
    [
      { header: 'STT', key: 'index', width: 6 },
      { header: 'Khâu', key: 'stage', width: 20 },
      { header: 'Thời gian', key: 'time', width: 18, numFmt: DATE_TIME_FMT },
      { header: 'Đơn vị thực hiện', key: 'org', width: 28, wrap: true },
      { header: 'Người thực hiện', key: 'person', width: 24, wrap: true },
      { header: 'Vai trò', key: 'role', width: 16 },
      { header: 'Địa điểm', key: 'location', width: 30, wrap: true },
      { header: 'Thông tin khâu', key: 'facts', width: 48, wrap: true },
      { header: 'Ghi chú', key: 'notes', width: 30, wrap: true },
      { header: 'Mã băm SHA-256', key: 'hash', width: 70 },
    ],
    report.steps.map((s) => ({
      index: s.index,
      stage: s.stageLabel,
      time: excelLocalDate(s.time),
      org: s.organization,
      person: s.person,
      role: s.role,
      location: s.location,
      // One fact per line inside the cell (Alt+Enter style line breaks).
      facts: s.facts.map((f) => `${f.label}: ${f.value}`).join('\n'),
      notes: s.notes,
      hash: s.hash,
    })),
  )

  if (report.anomalies.length > 0) {
    addTable(
      wb.addWorksheet('Cảnh báo', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } }),
      [
        { header: 'Mức độ', key: 'severity', width: 14 },
        { header: 'Nội dung', key: 'message', width: 70, wrap: true },
        { header: 'Phát hiện lúc', key: 'at', width: 18, numFmt: DATE_TIME_FMT },
        { header: 'Trạng thái', key: 'status', width: 14 },
      ],
      report.anomalies.map((a) => ({
        severity: a.severity,
        message: a.message,
        at: excelLocalDate(a.detectedAt),
        status: a.resolved ? 'Đã xử lý' : 'Chưa xử lý',
      })),
    )
  }

  return toBlob(wb)
}

export interface BatchListFilters {
  from?: string
  to?: string
  origin?: string
}

export async function buildBatchListXlsx(batches: Batch[], filters: BatchListFilters): Promise<Blob> {
  const now = new Date()
  const wb = await newWorkbook('Báo cáo danh sách lô hàng')
  addTable(
    wb.addWorksheet('Danh sách lô hàng', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' },
    }),
    [
      { header: 'STT', key: 'index', width: 6 },
      { header: 'Sản phẩm', key: 'name', width: 32, wrap: true },
      { header: 'Loại', key: 'type', width: 14 },
      { header: 'Xuất xứ', key: 'origin', width: 30, wrap: true },
      { header: 'Số lượng', key: 'qty', width: 12, numFmt: QTY_FMT },
      { header: 'Đơn vị', key: 'unit', width: 9 },
      { header: 'Khâu gần nhất', key: 'stage', width: 22 },
      { header: 'Trạng thái', key: 'status', width: 40, wrap: true },
      { header: 'Ngày tạo', key: 'created', width: 18, numFmt: DATE_TIME_FMT },
      { header: 'Cập nhật gần nhất', key: 'updated', width: 18, numFmt: DATE_TIME_FMT },
      { header: 'Mã lô', key: 'id', width: 38 },
    ],
    batches.map((b, i) => ({
      index: i + 1,
      name: b.productName,
      type: b.productType,
      origin: b.origin,
      qty: b.quantity,
      unit: b.unit,
      stage: b.currentStage ? STAGE_LABELS[b.currentStage] : 'Chưa bắt đầu',
      status: batchStatusText(b),
      created: excelLocalDate(new Date(b.createdAt)),
      updated: b.lastEventAt ? excelLocalDate(new Date(b.lastEventAt)) : null,
      id: b.id,
    })),
  )

  const fmtDay = (iso?: string) => {
    if (!iso) return 'Không giới hạn'
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
  }
  keyValueSheet(wb.addWorksheet('Thông tin xuất'), [
    ['Báo cáo', 'Danh sách lô hàng'],
    ['Từ ngày', fmtDay(filters.from)],
    ['Đến ngày', fmtDay(filters.to)],
    ['Xuất xứ', filters.origin || 'Tất cả'],
    ['Số lô', batches.length],
    ['Xuất lúc', formatDateTime(now)],
  ])
  return toBlob(wb)
}
