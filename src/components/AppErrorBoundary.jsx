import React from 'react'

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Application render error', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main style={{ color: '#e0e8f5', fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <h1 style={{ color: '#ff6b6b' }}>Portfolio Tracker could not display this screen</h1>
        <p>A display value was unavailable or invalid. Your portfolio data has not been changed.</p>
        <button
          onClick={() => window.location.reload()}
          style={{ background: '#1976d2', border: 0, borderRadius: 4, color: '#fff', cursor: 'pointer', padding: '0.65rem 1rem' }}
        >
          Reload Application
        </button>
      </main>
    )
  }
}
