import { useEffect, useRef, useState } from 'react'
import { inputClass } from './ui/field'
import { buttonClass } from './ui/Button'

interface Props {
  onScan: (result: string) => void
}

// Uses the browser BarcodeDetector API (Chrome 83+, Edge 83+, Android Chrome).
// On unsupported browsers, falls back to a manual text input.
export default function QRScanner({ onScan }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const rafRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)
  const [supported, setSupported] = useState<boolean | null>(null)
  const [cameraError, setCameraError] = useState('')
  const [manualId, setManualId] = useState('')

  useEffect(() => {
    const hasBD = 'BarcodeDetector' in window
    setSupported(hasBD)
    if (!hasBD) return

    type BarcodeDetectorResult = { rawValue: string }
    type BarcodeDetectorInstance = { detect: (img: HTMLVideoElement) => Promise<BarcodeDetectorResult[]> }
    type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorInstance
    const BD = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector

    const detector = new BD({ formats: ['qr_code'] })

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }

        const tick = () => {
          if (!videoRef.current) return
          detector
            .detect(videoRef.current)
            .then((results) => {
              if (results.length > 0) {
                onScan(results[0].rawValue)
              }
            })
            .catch(() => {})
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      })
      .catch(() => setCameraError('Không thể truy cập camera. Vui lòng cho phép quyền camera.'))

    return () => {
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [onScan])

  // Unsupported browser — show manual input
  if (supported === false) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-500/20 rounded-xl px-3.5 py-2.5">
          Trình duyệt không hỗ trợ quét QR tự động. Nhập ID lô hàng thủ công.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder="Nhập ID lô hàng..."
            className={`flex-1 ${inputClass}`}
          />
          <button onClick={() => manualId.trim() && onScan(manualId.trim())} className={buttonClass('primary', 'md')}>
            Tra cứu
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {cameraError ? (
        <p className="text-sm text-rose-500 dark:text-rose-400 text-center">{cameraError}</p>
      ) : (
        <div className="relative rounded-3xl overflow-hidden bg-black aspect-square max-w-xs mx-auto shadow-glow">
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
          {/* Viewfinder overlay with corner brackets */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-48 h-48">
              {(['top-0 left-0 border-t-2 border-l-2 rounded-tl-xl', 'top-0 right-0 border-t-2 border-r-2 rounded-tr-xl', 'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-xl', 'bottom-0 right-0 border-b-2 border-r-2 rounded-br-xl'] as const).map((pos) => (
                <div key={pos} className={`absolute w-8 h-8 border-emerald-400 ${pos}`} />
              ))}
            </div>
          </div>
          <p className="absolute bottom-3 left-0 right-0 text-center text-white/80 text-xs font-medium">
            Đặt mã QR vào khung
          </p>
        </div>
      )}

      {/* Also allow manual fallback */}
      <div className="flex gap-2">
        <input
          type="text"
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
          placeholder="Hoặc nhập ID thủ công..."
          className={`flex-1 ${inputClass}`}
        />
        <button onClick={() => manualId.trim() && onScan(manualId.trim())} className={buttonClass('primary', 'md')}>
          Tra cứu
        </button>
      </div>
    </div>
  )
}
