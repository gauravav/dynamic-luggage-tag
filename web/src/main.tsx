import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { SessionProvider } from './state/session'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root')

createRoot(container).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <SessionProvider>
        {/* reducedMotion="user": people who ask their OS for less motion get
            instant changes with fades only, everywhere, without per-component checks. */}
        <MotionConfig reducedMotion="user">
          <App />
        </MotionConfig>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
)
