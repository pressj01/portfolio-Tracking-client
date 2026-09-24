import React from 'react'
import ReactDOM from 'react-dom/client'
import bundledPlotly from 'plotly.js/dist/plotly'
import App from './App'
import CurrencyProvider from './context/CurrencyContext'
import AppErrorBoundary from './components/AppErrorBoundary'

// Use the same bundled Plotly version for imperative and React charts. The
// backend's typed-array chart payloads require a current Plotly renderer.
window.Plotly = bundledPlotly

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <CurrencyProvider>
        <App />
      </CurrencyProvider>
    </AppErrorBoundary>
  </React.StrictMode>
)
