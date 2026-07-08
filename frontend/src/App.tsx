import React, { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import RealtimeAlerts from './components/RealtimeAlerts'
import NavBar from './components/NavBar'

const Landing = lazy(() => import('./pages/Landing'))
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const RecordEvent = lazy(() => import('./pages/RecordEvent'))
const BatchDetail = lazy(() => import('./pages/BatchDetail'))
const Provenance = lazy(() => import('./pages/Provenance'))
const Profile = lazy(() => import('./pages/Profile'))
const Actors = lazy(() => import('./pages/Actors'))
const ActorDetail = lazy(() => import('./pages/ActorDetail'))
const TaskQueue = lazy(() => import('./pages/TaskQueue'))
const NotificationCenter = lazy(() => import('./pages/NotificationCenter'))
const Reports = lazy(() => import('./pages/Reports'))
const AnomalyMonitor = lazy(() => import('./pages/AnomalyMonitor'))
const AuditLog = lazy(() => import('./pages/AuditLog'))
const ChainVerifier = lazy(() => import('./pages/ChainVerifier'))
const HowItWorks = lazy(() => import('./pages/HowItWorks'))
const QRScan = lazy(() => import('./pages/QRScan'))

function PageLoading() {
  return (
    <div className="flex h-screen items-center justify-center dark:bg-slate-950">
      <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-sm">
        <span className="w-4 h-4 rounded-full border-2 border-slate-200 dark:border-slate-700 border-t-brand-500 animate-spin" />
        Đang tải...
      </div>
    </div>
  )
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { actor, isLoading } = useAuth()
  if (isLoading) return <PageLoading />
  if (!actor) return <Navigate to="/login" replace />
  return (
    <>
      <NavBar />
      {children}
    </>
  )
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { actor, isLoading, hasRole } = useAuth()
  if (isLoading) return <PageLoading />
  if (!actor) return <Navigate to="/login" replace />
  if (!hasRole('ADMIN')) return <Navigate to="/dashboard" replace />
  return (
    <>
      <NavBar />
      {children}
    </>
  )
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/provenance/:batchId" element={<Provenance />} />
        <Route path="/verify" element={<ChainVerifier />} />
        <Route path="/how-it-works" element={<HowItWorks />} />

        <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/record" element={<PrivateRoute><RecordEvent /></PrivateRoute>} />
        <Route path="/batch/:id" element={<PrivateRoute><BatchDetail /></PrivateRoute>} />
        <Route path="/profile" element={<PrivateRoute><Profile /></PrivateRoute>} />
        <Route path="/actors" element={<PrivateRoute><Actors /></PrivateRoute>} />
        <Route path="/actors/:id" element={<PrivateRoute><ActorDetail /></PrivateRoute>} />
        <Route path="/tasks" element={<PrivateRoute><TaskQueue /></PrivateRoute>} />
        <Route path="/notifications" element={<PrivateRoute><NotificationCenter /></PrivateRoute>} />
        <Route path="/reports" element={<PrivateRoute><Reports /></PrivateRoute>} />
        <Route path="/scan" element={<PrivateRoute><QRScan /></PrivateRoute>} />

        <Route path="/admin/anomalies" element={<AdminRoute><AnomalyMonitor /></AdminRoute>} />
        <Route path="/admin/audit-logs" element={<AdminRoute><AuditLog /></AdminRoute>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <RealtimeAlerts />
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}
