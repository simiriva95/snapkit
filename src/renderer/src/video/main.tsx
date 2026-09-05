import React from 'react'
import ReactDOM from 'react-dom/client'
import { VideoEditor } from './VideoEditor'
import '../index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <VideoEditor />
  </React.StrictMode>
)
