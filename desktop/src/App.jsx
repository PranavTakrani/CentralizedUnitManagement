import { useState } from 'react'
import Tasks from './Tasks'
import Meals from './Meals'

const tabs = ['Tasks', 'Meals']

export default function App() {
  const [tab, setTab] = useState(0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Title bar / drag region */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        padding: '0 12px', height: 40, flexShrink: 0,
        WebkitAppRegion: 'drag',
      }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--red)', letterSpacing: 1 }}>CUM</span>
        <div style={{ display: 'flex', gap: 4, WebkitAppRegion: 'no-drag' }}>
          {tabs.map((t, i) => (
            <button key={t} onClick={() => setTab(i)} style={{
              padding: '4px 14px', fontSize: 13, fontWeight: 600,
              background: tab === i ? 'var(--red)' : 'transparent',
              color: tab === i ? '#fff' : 'var(--text-dim)',
              borderRadius: 4,
            }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', padding: 12 }}>
        {tab === 0 ? <Tasks /> : <Meals />}
      </div>
    </div>
  )
}
