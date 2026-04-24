import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/fraunces'
import '@xterm/xterm/css/xterm.css'
import './styles/globals.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

ReactDOM.createRoot(root).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
