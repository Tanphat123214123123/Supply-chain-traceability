import { useNavigate } from 'react-router-dom'
import { Camera } from 'lucide-react'
import QRScanner from '../components/QRScanner'

/** Extracts a batch id whether the QR encodes a bare id or a full /provenance/:id URL. */
function extractBatchId(scanned: string): string {
  try {
    const url = new URL(scanned)
    const parts = url.pathname.split('/').filter(Boolean)
    const idx = parts.indexOf('provenance')
    if (idx !== -1 && parts[idx + 1]) return parts[idx + 1]
  } catch {
    // not a URL — treat the scanned value as a raw batch id
  }
  return scanned
}

export default function QRScan() {
  const navigate = useNavigate()

  const handleScan = (value: string) => {
    const batchId = extractBatchId(value.trim())
    if (batchId) navigate(`/batch/${batchId}`)
  }

  return (
    <div className="page-shell p-4">
      <div className="max-w-sm mx-auto py-8">
        <div className="text-center mb-6 animate-slide-up">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-brand-500 to-emerald-500 flex items-center justify-center text-white mb-4 shadow-glow">
            <Camera className="w-7 h-7" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Quét mã QR lô hàng</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Đưa camera vào mã QR in trên bao bì để xem chi tiết lô hàng.</p>
        </div>
        <QRScanner onScan={handleScan} />
      </div>
    </div>
  )
}
