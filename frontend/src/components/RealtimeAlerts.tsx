import { useEffect, useState } from 'react'
import { Siren, TriangleAlert } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { connectSocket, disconnectSocket, Anomaly, Batch } from '../api/client'

interface ToastItem {
  id: string
  message: string
  kind: 'anomaly' | 'recall'
}

const TOAST_LIFETIME_MS = 6000

export default function RealtimeAlerts() {
  const { token } = useAuth()
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    // The backend now requires a valid access token at the Socket.IO
    // handshake, so there's nothing to connect to before login (or after
    // logout) — this also keeps toasts scoped to being an authenticated user.
    if (!token) {
      disconnectSocket()
      return
    }

    const socket = connectSocket(token)

    const push = (toast: ToastItem) => {
      setToasts((prev) => [...prev, toast])
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== toast.id)), TOAST_LIFETIME_MS)
    }

    const onAnomaly = (anomaly: Anomaly) => {
      push({ id: anomaly.id, message: anomaly.message, kind: 'anomaly' })
    }
    const onRecall = (batch: Batch) => {
      push({ id: `recall-${batch.id}-${Date.now()}`, message: `Lô "${batch.productName}" đã bị thu hồi`, kind: 'recall' })
    }

    socket.on('anomaly', onAnomaly)
    socket.on('recall', onRecall)
    return () => {
      socket.off('anomaly', onAnomaly)
      socket.off('recall', onRecall)
    }
  }, [token])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={`rounded-xl px-4 py-3 text-sm shadow-card-hover dark:shadow-none text-white backdrop-blur-sm animate-slide-up flex items-start gap-2 ${
            t.kind === 'recall' ? 'bg-rose-600/95 dark:bg-rose-600/90' : 'bg-amber-500/95 dark:bg-amber-500/90'
          }`}
        >
          {t.kind === 'recall' ? <Siren className="w-4 h-4 flex-shrink-0" /> : <TriangleAlert className="w-4 h-4 flex-shrink-0" />}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}
