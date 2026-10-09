// @vitest-environment node
import { readFileSync } from 'fs'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { Actor, TraceResult } from '../../api/client'
import { buildBatchReport, fileSlug, formatDateTime, isoLocal } from './model'
import { buildBatchListXlsx, buildBatchXlsx, excelLocalDate } from './xlsx'
import { buildBatchDocx } from './docx'
import { buildBatchPdf } from './pdf'

const actor: Actor = { id: 'a1', name: 'Nguyễn Văn Nông', role: 'FARMER', organization: 'HTX Cầu Đất', createdAt: '', isActive: true }

const result: TraceResult = {
  batch: {
    id: '8162d83d-c00e-4cfa-b0c8-e4f3ac4070a3',
    productName: 'Cà phê Robusta Cầu Đất',
    productType: 'Cà phê',
    origin: 'Cầu Đất, Đà Lạt, Lâm Đồng',
    quantity: 1234.5,
    unit: 'kg',
    createdAt: '2026-10-04T14:20:00.000Z',
    createdBy: 'a1',
    currentStage: 'HARVEST',
    isRecalled: false,
    metadata: {},
    headHash: 'h',
    eventCount: 1,
    consumedQuantity: 0,
  },
  events: [
    {
      id: 'e1',
      batchId: 'b',
      stage: 'HARVEST',
      actorId: 'a1',
      timestamp: '2026-10-04T14:20:00.000Z',
      location: 'Cầu Đất, Đà Lạt',
      notes: 'Hái chín 95%',
      data: { harvestDate: '2026-10-04', variety: 'Robusta TR4', cultivation: 'VIETGAP' },
      hash: 'a'.repeat(64),
      prevHash: '0'.repeat(64),
      sequenceNumber: 0,
      hashVersion: 2,
      kind: 'OBSERVE',
      links: [],
    },
  ],
  anomalies: [],
  isValid: true,
}

const report = () => buildBatchReport(result, new Map([[actor.id, actor]]), 'https://trace.example/provenance/8162')

describe('report model', () => {
  it('formats dates identically everywhere (no browser-dependent toLocaleString)', () => {
    const d = new Date(2026, 9, 4, 9, 5)
    expect(formatDateTime(d)).toBe('04/10/2026 09:05')
    expect(isoLocal(d)).toMatch(/^2026-10-04T09:05:00[+-]\d{2}:\d{2}$/)
  })

  it('builds portable file names without diacritics', () => {
    expect(fileSlug('Cà phê Robusta Cầu Đất')).toBe('ca-phe-robusta-cau-dat')
    expect(report().fileBase).toBe('hanh-trinh-ca-phe-robusta-cau-dat-8162d83d')
  })

  it('resolves people, stage labels and stage facts', () => {
    const step = report().steps[0]
    expect(step).toMatchObject({ stageLabel: 'Thu hoạch', organization: 'HTX Cầu Đất', person: 'Nguyễn Văn Nông', role: 'Nông dân' })
    expect(step.facts).toContainEqual({ label: 'Tiêu chuẩn canh tác', value: 'VietGAP' })
  })
})

describe('Excel (.xlsx)', () => {
  it('writes typed cells: real dates in local wall-clock time, numeric quantities, Vietnamese text intact', async () => {
    const blob = await buildBatchXlsx(report())
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())

    expect(wb.worksheets.map((w) => w.name)).toEqual(['Thông tin lô', 'Hành trình'])
    expect(wb.creator).toBe('TraceChain')

    const info = wb.getWorksheet('Thông tin lô')!
    const qtyRow = info.getRows(1, info.rowCount)!.find((r) => r.getCell(1).value === 'Số lượng')!
    expect(qtyRow.getCell(2).value).toBe(1234.5)
    expect(qtyRow.getCell(2).numFmt).toBe('#,##0.###')

    const journey = wb.getWorksheet('Hành trình')!
    expect(journey.getRow(1).getCell(2).value).toBe('Khâu')
    expect(journey.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    const time = journey.getRow(2).getCell(3)
    expect(time.value).toBeInstanceOf(Date)
    expect(time.numFmt).toBe('dd/mm/yyyy hh:mm')
    expect((time.value as Date).getTime()).toBe(excelLocalDate(new Date(result.events[0].timestamp)).getTime())
    expect(journey.getRow(2).getCell(4).value).toBe('HTX Cầu Đất')
    expect(String(journey.getRow(2).getCell(8).value)).toContain('Giống: Robusta TR4')
  })

  it('exports a batch list with filters recorded', async () => {
    const blob = await buildBatchListXlsx([result.batch], { from: '2026-10-01', origin: 'Lâm Đồng' })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    const list = wb.getWorksheet('Danh sách lô hàng')!
    expect(list.getRow(2).getCell(2).value).toBe('Cà phê Robusta Cầu Đất')
    expect(list.getRow(2).getCell(5).value).toBe(1234.5)
    expect(list.getRow(2).getCell(9).value).toBeInstanceOf(Date)
    expect(list.autoFilter).toBeTruthy()
    const meta = wb.getWorksheet('Thông tin xuất')!
    expect(meta.getRow(2).getCell(2).value).toBe('01/10/2026')
  })
})

describe('Word (.docx)', () => {
  it('is a valid OOXML package in Times New Roman, tagged vi-VN, on A4 with administrative margins', async () => {
    const blob = await buildBatchDocx(report())
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'word/document.xml', 'word/styles.xml', 'docProps/core.xml']))

    const styles = await zip.file('word/styles.xml')!.async('string')
    expect(styles).toContain('w:ascii="Times New Roman"')
    expect(styles).toContain('w:val="vi-VN"')
    expect(styles).toContain('w:sz w:val="26"') // 13 pt

    const doc = await zip.file('word/document.xml')!.async('string')
    expect(doc).toContain('BÁO CÁO HÀNH TRÌNH LÔ HÀNG')
    expect(doc).toContain('Cà phê Robusta Cầu Đất')
    expect(doc).toContain('HTX Cầu Đất')
    const pgSz = doc.match(/<w:pgSz[^>]*>/)?.[0] ?? ''
    expect(pgSz).toContain('w:w="11906"') // A4 210 mm in twips
    expect(pgSz).toContain('w:h="16838"') // A4 297 mm
    expect(doc).toMatch(/w:left="1701"/) // 30 mm
    expect(doc).toContain('<w:tblHeader') // table header repeats on each page

    const core = await zip.file('docProps/core.xml')!.async('string')
    expect(core).toContain('TraceChain')
  })
})

describe('PDF', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => {
    // Serve /fonts/* from public/ the way the dev server / nginx would.
    globalThis.fetch = vi.fn(async (url: string) => {
      const buf = readFileSync(join(__dirname, '../../../public', url))
      return new Response(buf)
    }) as unknown as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('embeds the Vietnamese font, declares its language and metadata, and is A4', async () => {
    const blob = await buildBatchPdf(report())
    const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1')
    // Booleans, not raw matches: a failure must not dump the binary into the log.
    expect(pdf.startsWith('%PDF-1.')).toBe(true)
    expect(/\/FontFile2/.test(pdf)).toBe(true) // TrueType program embedded, not merely referenced
    expect(/\/BaseFont \/BeVietnamPro/.test(pdf)).toBe(true)
    expect(/\/ToUnicode/.test(pdf)).toBe(true) // text stays searchable / copyable as Unicode
    expect(pdf.includes('/Lang (vi)')).toBe(true)
    expect(/\/MediaBox \[0 0 595\.\d+ 841\.\d+\]/.test(pdf)).toBe(true) // A4 in points
    expect(pdf.includes('/Author (TraceChain)')).toBe(true)
  })
})
