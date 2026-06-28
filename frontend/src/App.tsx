import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import RecordEvent from './pages/RecordEvent'
import BatchDetail from './pages/BatchDetail'
import Provenance from './pages/Provenance'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { actor, isLoading } = useAuth()
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-400 text-sm">
        Đang tải...
      </div>
    )
  }
  return actor ? <>{children}</> : <Navigate to="/login" replace />
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/provenance/:batchId" element={<Provenance />} />
      <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
      <Route path="/record" element={<PrivateRoute><RecordEvent /></PrivateRoute>} />
      <Route path="/batch/:id" element={<PrivateRoute><BatchDetail /></PrivateRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
