import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { PwaLifecycle } from './features/reminders/PwaLifecycle'
import './index.css'
import './responsive.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <>
      <App />
      <PwaLifecycle />
    </>
  </React.StrictMode>,
)
