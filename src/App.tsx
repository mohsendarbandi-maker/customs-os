import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="min-h-screen bg-gray-50 text-gray-900 dir-rtl font-sans flex items-center justify-center">
          <Routes>
            <Route path="/" element={<div className="p-8 text-center text-2xl font-bold bg-white rounded-xl shadow-lg">Customs OS - Phase 1 Foundation Active 🚀</div>} />
          </Routes>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
