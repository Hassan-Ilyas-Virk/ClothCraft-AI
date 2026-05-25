/**
 * main.jsx — Application entry point.
 *
 * Mounts the React tree into the #root div defined in index.html.
 * StrictMode double-invokes effects and renders in development to surface
 * side-effect bugs; it has no impact in the production build.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

