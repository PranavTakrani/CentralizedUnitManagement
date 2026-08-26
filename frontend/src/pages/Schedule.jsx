import { useEffect, useState, useRef } from 'react'
import api from '../lib/api'
import { supabase } from '../lib/supabase'

const SLOT_H = 48
const GUTTER_W = 52
const DAY_COL_W = 120
const DAYS = 7
const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x }
const toMins = (iso) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes() }
const fmtDay = (d) => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

export default function Schedule() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [calendars, setCalendars] = useState([])
  const [showCalendars, setShowCalendars] = useState(false)
  const [newCalId, setNewCalId] = useState('')
  const [newCalLabel, setNewCalLabel] = useState('')
  const scrollRef = useRef(null)
  const now = new Date()

  const hours = Array.from({ length: 24 }, (_, i) => i)
  const nowMins = now.getHours() * 60 + now.getMinutes()
  const nowTop = (nowMins / 60) * SLOT_H

  const loadCalendars = async () => {
    const { data } = await supabase.from('calendars').select('*').order('created_at')
    setCalendars(data ?? [])
  }

  useEffect(() => {
    api.get('/calendar/upcoming', { params: { days: DAYS } }).then(r => setEvents(r.data)).catch(() => {}).finally(() => setLoading(false))
    loadCalendars()
  }, [])

  useEffect(() => {
    if (!loading && scrollRef.current) {
      const el = scrollRef.current
      requestAnimationFrame(() => {
        el.scrollTop = Math.max(0, nowTop - SLOT_H * 2)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  const addCalendar = async () => {
    if (!newCalId.trim()) return
    const { error } = await supabase.from('calendars').insert({
      calendar_id: newCalId.trim(), label: newCalLabel.trim() || null,
    })
    if (error) { console.error('Insert calendar error:', error); return }
    setNewCalId(''); setNewCalLabel(''); loadCalendars()
  }

  const removeCalendar = async (id) => {
    await supabase.from('calendars').delete().eq('id', id)
    loadCalendars()
  }

  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i); d.setHours(0,0,0,0); return d
  })

  const eventsForDay = (day) => events
    .filter(e => e.start && startOfDay(new Date(e.start)).getTime() === day.getTime())
    .map(e => ({ ...e, startM: toMins(e.start), dur: e.end ? toMins(e.end) - toMins(e.start) : 60 }))

  const gridMinWidth = GUTTER_W + DAYS * DAY_COL_W

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 'var(--gap)' }}>
      <div className="card" style={{ flexShrink: 0 }}>
        <button onClick={() => setShowCalendars(v => !v)} style={{ background: 'transparent', color: 'var(--text-dim)', padding: '4px 0' }}>
          {showCalendars ? '−' : '+'} Manage calendars ({calendars.length})
        </button>
        {showCalendars && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {calendars.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: '0 0 160px', color: 'var(--text)' }}>{c.label || '—'}</span>
                <span style={{ flex: '1 1 200px', minWidth: 0, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.calendar_id}</span>
                <button onClick={() => removeCalendar(c.id)} style={{ padding: '4px 10px', minHeight: 30, color: 'var(--red-bright)', background: 'transparent' }}>✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              <input
                value={newCalId}
                onChange={e => setNewCalId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCalendar()}
                placeholder="Calendar ID / email..."
                style={{ flex: '1 1 220px', minWidth: 0 }}
              />
              <input
                value={newCalLabel}
                onChange={e => setNewCalLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCalendar()}
                placeholder="Label (optional)"
                style={{ flex: '0 1 160px', minWidth: 0 }}
              />
              <button onClick={addCalendar} style={{ background: 'var(--red)', color: '#fff', fontWeight: 600 }}>Add</button>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: 0, overflow: 'hidden' }}>
        <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}>
          <div style={{ minWidth: gridMinWidth }}>
            <div style={{
              display: 'flex', position: 'sticky', top: 0, zIndex: 3,
              background: 'var(--surface)', paddingLeft: GUTTER_W, paddingTop: 12, paddingBottom: 8,
            }}>
              {days.map((d, i) => (
                <div key={i} style={{
                  flex: `0 0 ${DAY_COL_W}px`, textAlign: 'center',
                  fontSize: 'clamp(0.78rem, 1.3vw, 0.95rem)', fontWeight: 600,
                  color: i === 0 ? 'var(--red)' : 'var(--text-dim)',
                  paddingBottom: 8, borderBottom: `2px solid ${i === 0 ? 'var(--red)' : 'var(--border)'}`,
                }}>
                  {fmtDay(d)}
                </div>
              ))}
            </div>

            <div style={{ position: 'relative', display: 'flex', padding: '0 0 12px' }}>
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
                <div key={di} style={{ flex: `0 0 ${DAY_COL_W}px`, position: 'relative', borderLeft: '1px solid var(--border)' }}>
                  {hours.map(h => <div key={h} style={{ height: SLOT_H, borderTop: '1px solid var(--border)' }} />)}
                  {di === 0 && <div style={{ position: 'absolute', top: nowTop, left: 0, right: 0, height: 2, background: 'var(--red)', boxShadow: '0 0 6px var(--red)', zIndex: 2 }} />}
                  {eventsForDay(day).map((e, i) => {
                    const top = (e.startM / 60) * SLOT_H
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
          </div>
        </div>
        {loading && <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 8 }}>Loading...</div>}
      </div>
    </div>
  )
}
