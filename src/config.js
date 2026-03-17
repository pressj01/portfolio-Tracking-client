// In dev (Vite), the proxy handles /api → localhost:5001
// In production (Electron file://), we need the full URL
const isDev = window.location.protocol === 'http:'
export const API_BASE = isDev ? '' : 'http://localhost:5001'
