import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import CurrencyProvider from './context/CurrencyContext'
import AppErrorBoundary from './components/AppErrorBoundary'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <CurrencyProvider>
        <App />
      </CurrencyProvider>
    </AppErrorBoundary>
  </React.StrictMode>
)
