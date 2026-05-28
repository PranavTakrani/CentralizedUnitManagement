import { useEffect, useState, useCallback, useRef } from 'react'
import api from '../lib/api'

export default function Spotify() {
  const [data, setData] = useState(null)
  const clickCount = useRef(0)
  const clickTimer = useRef(null)

  const fetchNow = useCallback(() => {
    api.get('/spotify/now-playing').then(r => setData(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    fetchNow()
    const id = setInterval(fetchNow, 3000)
    return () => clearInterval(id)
  }, [fetchNow])

  const ctrl = (endpoint) => {
    if (endpoint === '/spotify/play') setData(d => d ? { ...d, is_playing: !d.is_playing } : d)
    api.post(endpoint).then(() => setTimeout(fetchNow, 500))
  }

  useEffect(() => {
    const handleKey = (e) => {
      switch (e.key) {
        case 'MediaPlayPause':
          // middle button — count clicks, resolve after 300ms
          e.preventDefault()
          clickCount.current += 1
          clearTimeout(clickTimer.current)
          clickTimer.current = setTimeout(() => {
            const n = clickCount.current
            clickCount.current = 0
            if (n === 1) ctrl('/spotify/play')
            else if (n === 2) ctrl('/spotify/next')
            else if (n >= 3) ctrl('/spotify/previous')
          }, 300)
          break
        case 'MediaTrackNext':
          e.preventDefault()
          ctrl('/spotify/next')
          break
        case 'MediaTrackPrevious':
          e.preventDefault()
          ctrl('/spotify/previous')
          break
        case 'AudioVolumeUp':
        case 'VolumeUp':
          e.preventDefault()
          api.post('/spotify/volume', null, { params: { volume: Math.min(100, (data?.volume_percent ?? 50) + 10) } }).then(fetchNow)
          break
        case 'AudioVolumeDown':
        case 'VolumeDown':
          e.preventDefault()
          api.post('/spotify/volume', null, { params: { volume: Math.max(0, (data?.volume_percent ?? 50) - 10) } }).then(fetchNow)
          break
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [data])

  const ctrl = (endpoint) => {
    if (endpoint === '/spotify/play') setData(d => d ? { ...d, is_playing: !d.is_playing } : d)
    api.post(endpoint).then(() => setTimeout(fetchNow, 500))
  }

  const pct = data?.duration_ms ? Math.max(0, Math.min(100, (data.progress_ms / data.duration_ms) * 100)) : 0
  const fmtMs = (ms) => {
    const s = Math.floor(Math.max(0, ms) / 1000)
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
