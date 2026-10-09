/** Standard IANA media types for each export, so the OS opens the right application. */
export const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json;charset=utf-8',
  svg: 'image/svg+xml',
  geojson: 'application/geo+json',
} as const

export function downloadBlob(filename: string, data: Blob | ArrayBuffer | string, mime: string): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick: some browsers (Firefox, Safari) cancel the download if it's revoked synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Cached as base64 for jsPDF; fetched only when a PDF is actually generated. */
const fontCache = new Map<string, Promise<string>>()

export function loadFontBase64(url: string): Promise<string> {
  let p = fontCache.get(url)
  if (!p) {
    p = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Font ${url}: HTTP ${res.status}`)
        return res.arrayBuffer()
      })
      .then((buf) => {
        const bytes = new Uint8Array(buf)
        let binary = ''
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        return btoa(binary)
      })
    p.catch(() => fontCache.delete(url))
    fontCache.set(url, p)
  }
  return p
}
