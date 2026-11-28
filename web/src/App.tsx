import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RechartsThemeProvider } from 'recharts'
import { Shell } from './components/Shell'
import { chartTheme } from './lib/chartTheme'
import { ComparePage } from './pages/Compare'
import { DashboardPage } from './pages/Dashboard'
import { EvasionLabPage } from './pages/EvasionLab'
import { PromptScanPage } from './pages/PromptScan'
import { TraceInspectorPage } from './pages/TraceInspector'

export default function App() {
  return (
    <RechartsThemeProvider value={chartTheme}>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<DashboardPage />} />
            <Route path="scan" element={<PromptScanPage />} />
            <Route path="traces" element={<TraceInspectorPage />} />
            <Route path="compare" element={<ComparePage />} />
            <Route path="evasion" element={<EvasionLabPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </RechartsThemeProvider>
  )
}
