import './i18n/index';
import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted: Google's CDN would hand every visitor's IP to Google.
import '@fontsource/montserrat/400.css'
import '@fontsource/montserrat/500.css'
import '@fontsource/montserrat/700.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <App />
    </Suspense>
  </StrictMode>,
)
