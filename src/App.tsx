import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const queryClient = new QueryClient()

function Home() {
  return (
    <main
      dir="rtl"
      className="min-h-screen bg-gray-50 text-gray-900 flex items-center justify-center p-6"
    >
      <section className="w-full max-w-xl rounded-2xl bg-white p-8 text-center shadow-lg">
        <h1 className="mb-3 text-3xl font-bold">
          Customs OS
        </h1>

        <p className="text-gray-600">
          سیستم مدیریت عملیات گمرکی
        </p>

        <div className="mt-6 rounded-xl bg-gray-100 p-4 text-sm">
          Phase 1 Foundation
        </div>
      </section>
    </main>
  )
}

function NotFound() {
  return (
    <main
      dir="rtl"
      className="min-h-screen flex items-center justify-center p-6"
    >
      <div className="text-center">
        <h1 className="text-4xl font-bold">404</h1>
        <p className="mt-2 text-gray-600">صفحه موردنظر پیدا نشد.</p>
      </div>
    </main>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}