import { useEffect, useState, useRef } from 'react'
import api from '../lib/api'

const SLOT_H = 48
const GUTTER_W = 52
const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x }
const toMins = (iso) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes() }
const fmtDay = (d) => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

export default function Schedule() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const scrollRef = useRef(null)
  const now = new Date()

  const startH = Math.max(0, now.getHours() - 2)
  const endH = Math.min(23, now.getHours() + 10)
  const hours = Array.from({ length: endH - startH + 1 }, (_, i) => startH + i)
  const nowMins = now.getHours() * 60 + now.getMinutes()
  const nowTop = (nowMins / 60 - startH) * SLOT_H

  useEffect(() => {
    api.get('/calendar/upcoming').then(r => setEvents(r.data)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!loading && scrollRef.current) scrollRef.current.scrollTop = 0
  }, [loading])

  const days = Array.from({ length: 3 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i); d.setHours(0,0,0,0); return d
  })

  const eventsForDay = (day) => events
    .filter(e => e.start && startOfDay(new Date(e.start)).getTime() === day.getTime())
    .map(e => ({ ...e, startM: toMins(e.start), dur: e.end ? toMins(e.end) - toMins(e.start) : 60 }))

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 10 }}>
      <div style={{ display: 'flex', paddingLeft: GUTTER_W, flexShrink: 0 }}>
        {days.map((d, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 'clamp(0.8rem, 1.4vw, 1rem)', fontWeight: 600, color: i === 0 ? 'var(--red)' : 'var(--text-dim)', paddingBottom: 8, borderBottom: `2px solid ${i === 0 ? 'var(--red)' : 'var(--border)'}` }}>
            {fmtDay(d)}
          </div>
        ))}
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0, position: 'relative', display: 'flex' }}>
        <div style={{ width: GUTTER_W, flexShrink: 0 }}>
          {hours.map(h => (
            <div key={h} style={{ height: SLOT_H, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 10, paddingTop: 3 }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h-12}p`}
              </span>
            </div>
          ))}
        </div>

        {days.map((day, di) => (
          <div key={di} style={{ flex: 1, position: 'relative', borderLeft: '1px solid var(--border)' }}>
            {hours.map(h => <div key={h} style={{ height: SLOT_H, borderTop: '1px solid var(--border)' }} />)}
            {di === 0 && <div style={{ position: 'absolute', top: nowTop, left: 0, right: 0, height: 2, background: 'var(--red)', boxShadow: '0 0 6px var(--red)', zIndex: 2 }} />}
            {eventsForDay(day).map((e, i) => {
              const top = (e.startM / 60 - startH) * SLOT_H
              if (top < 0 || top > hours.length * SLOT_H) return null
              return (
                <div key={i} style={{ position: 'absolute', top: top + 1, left: 3, right: 3, height: Math.max((e.dur / 60) * SLOT_H - 2, 24), background: 'var(--red)', borderRadius: 6, padding: '3px 8px', overflow: 'hidden', zIndex: 1 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
                  {e.location && <div style={{ fontSize: '0.75rem', opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.location}</div>}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {loading && <div style={{ color: 'var(--text-dim)', textAlign: 'center' }}>Loading...</div>}
    </div>
  )
}
