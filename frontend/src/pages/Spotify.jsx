import { useEffect, useState } from 'react'
import api from '../lib/api'

export default function Spotify() {
  const [data, setData] = useState(null)

  const fetch = () => api.get('/spotify/now-playing').then(r => setData(r.data)).catch(() => {})

  useEffect(() => {
    fetch()
    const id = setInterval(fetch, 3000)
    return () => clearInterval(id)
  }, [])

  const ctrl = (endpoint) => {
    if (endpoint === '/spotify/play') setData(d => d ? { ...d, is_playing: !d.is_playing } : d)
    api.post(endpoint).then(fetch)
  }

  const pct = data?.duration_ms ? (data.progress_ms / data.duration_ms) * 100 : 0
  const fmtMs = (ms) => {
    const s = Math.floor(ms / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center', height: '100%', paddingBottom: 70 }}>
      {data?.album_art && (
        <img src={data.album_art} alt="album" style={{ width: 200, height: 200, borderRadius: 8, objectFit: 'cover', border: '2px solid var(--border)', flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {data?.track ? (
          <>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{data.track}</div>
              <div style={{ color: 'var(--text-dim)', fontSize: 14 }}>{data.artist}</div>
              <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>{data.album}</div>
            </div>

            <div>
              <div style={{ background: 'var(--border)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--red)', transition: 'width 1s linear' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                <span>{fmtMs(data.progress_ms)}</span>
                <span>{fmtMs(data.duration_ms)}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => ctrl('/spotify/previous')} style={{ flex: 1, fontSize: 20, padding: '12px 0' }}>⏮</button>
              <button onClick={() => ctrl('/spotify/play')} style={{ flex: 2, fontSize: 20, padding: '12px 0', background: 'var(--red)', color: '#fff' }}>
                {data.is_playing ? '⏸' : '▶'}
              </button>
              <button onClick={() => ctrl('/spotify/next')} style={{ flex: 1, fontSize: 20, padding: '12px 0' }}>⏭</button>
            </div>
          </>
        ) : (
          <div style={{ color: 'var(--text-dim)' }}>Nothing playing</div>
        )}
      </div>
    </div>
  )
}
