import React from 'react'
import ReactDOM from 'react-dom/client'
import '../index.css'

function Placeholder(): React.JSX.Element {
  const [name, setName] = React.useState('waiting for a file…')
  React.useEffect(
    () => window.videoApi.onOpen((p) => setName(`${p.name} (${p.sizeBytes} bytes)`)),
    []
  )
  return <div className="p-6 text-sm">{name}</div>
}
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<Placeholder />)
