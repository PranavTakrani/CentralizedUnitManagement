import { useEffect, useState, useRef } from 'react'
import api from '../lib/api'
import { supabase } from '../lib/supabase'

const SLOT_H = 48
const GUTTER_W = 52
const DAY_COL_W = 120
const DAYS = 7
const pad = (n) => String(n).padStart(2, '0')
const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x }
const toMins = (iso) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes() }
const fmtDay = (d) => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export default function Schedule() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [calendars, setCalendars] = useState([])
  const [showCalendars, setShowCalendars] = useState(false)
  const [newCalId, setNewCalId] = useState('')
  const [newCalLabel, setNewCalLabel] = useState('')

  // ---- shared calendars (backend-sourced, NOT Google) ----
  const [sharedCals, setSharedCals] = useState([])          // [{id,name,color,owner_id}]
  const [sharedEvents, setSharedEvents] = useState([])       // [{id,calendar_id,title,starts_at,ends_at,location}]
  const [showShared, setShowShared] = useState(false)
  const [newSharedName, setNewSharedName] = useState('')
  const [newSharedColor, setNewSharedColor] = useState('#3ea6ff')
  const [memberEmail, setMemberEmail] = useState({})         // calendarId -> email draft
  const [sharedForm, setSharedForm] = useState({ calendar_id: '', title: '', date: '', start: '09:00', end: '10:00', location: '' })
  const [sharedErr, setSharedErr] = useState(null)

  const scrollRef = useRef(null)
  const now = new Date()

  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay())
  weekStart.setHours(0, 0, 0, 0)
  const todayIndex = now.getDay()

  const hours = Array.from({ length: 24 }, (_, i) => i)
  const nowMins = now.getHours() * 60 + now.getMinutes()
  const nowTop = (nowMins / 60) * SLOT_H

  const loadCalendars = async () => {
    const { data } = await supabase.from('calendars').select('*').order('created_at')
    setCalendars(data ?? [])
  }

  const loadShared = async () => {
    try {
      const [cals, evs] = await Promise.all([
        api.get('/shared-calendar/list'),
        api.get('/shared-calendar/events'),
      ])
      setSharedCals(Array.isArray(cals.data) ? cals.data : [])
      setSharedEvents(Array.isArray(evs.data) ? evs.data : [])
    } catch {
      setSharedCals([]); setSharedEvents([])
    }
  }

  useEffect(() => {
    api.get('/calendar/upcoming', { params: { days: DAYS, start: dateStr(weekStart) } }).then(r => setEvents(Array.isArray(r.data) ? r.data : [])).catch(() => {}).finally(() => setLoading(false))
    loadCalendars()
    loadShared()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ---- shared-calendar handlers ----
  const sharedColorById = Object.fromEntries(sharedCals.map(c => [c.id, c.color]))

  const createShared = async () => {
    setSharedErr(null)
    if (!newSharedName.trim()) return
    try {
      await api.post('/shared-calendar/create', { name: newSharedName.trim(), color: newSharedColor })
      setNewSharedName(''); setNewSharedColor('#3ea6ff'); loadShared()
    } catch (e) { setSharedErr(e?.response?.data?.detail || 'create failed') }
  }

  const deleteShared = async (id) => {
    try { await api.delete(`/shared-calendar/${id}`); loadShared() }
    catch (e) { setSharedErr(e?.response?.data?.detail || 'delete failed') }
  }

  const addMember = async (calendarId) => {
    const email = (memberEmail[calendarId] || '').trim()
    if (!email) return
    setSharedErr(null)
    try {
      await api.post('/shared-calendar/members', { calendar_id: calendarId, email })
      setMemberEmail(m => ({ ...m, [calendarId]: '' }))
    } catch (e) { setSharedErr(e?.response?.data?.detail || 'could not add member') }
  }

  const addSharedEvent = async () => {
    setSharedErr(null)
    const { calendar_id, title, date, start, end, location } = sharedForm
    if (!calendar_id || !title.trim() || !date) { setSharedErr('pick a calendar, title, and date'); return }
    try {
      await api.post('/shared-calendar/events', {
        calendar_id,
        title: title.trim(),
        starts_at: new Date(`${date}T${start}`).toISOString(),
        ends_at: new Date(`${date}T${end}`).toISOString(),
        location: location.trim() || null,
      })
      setSharedForm(f => ({ ...f, title: '', location: '' }))
      loadShared()
    } catch (e) { setSharedErr(e?.response?.data?.detail || 'could not add event') }
  }

  const deleteSharedEvent = async (id) => {
    try { await api.delete(`/shared-calendar/events/${id}`); loadShared() }
    catch (e) { setSharedErr(e?.response?.data?.detail || 'delete failed') }
  }

  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d
  })

  const eventsForDay = (day) => {
    const google = events
      .filter(e => e.start && startOfDay(new Date(e.start)).getTime() === day.getTime())
      .map(e => ({ id: `g-${e.title}-${e.start}`, title: e.title, location: e.location, startM: toMins(e.start), dur: e.end ? toMins(e.end) - toMins(e.start) : 60, color: 'var(--red)', shared: false }))
    const shared = sharedEvents
      .filter(e => e.starts_at && startOfDay(new Date(e.starts_at)).getTime() === day.getTime())
      .map(e => ({ id: e.id, title: e.title, location: e.location, startM: toMins(e.starts_at), dur: e.ends_at ? toMins(e.ends_at) - toMins(e.starts_at) : 60, color: sharedColorById[e.calendar_id] || '#3ea6ff', shared: true }))
    return [...google, ...shared]
  }

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

      <div className="card" style={{ flexShrink: 0 }}>
        <button onClick={() => setShowShared(v => !v)} style={{ background: 'transparent', color: 'var(--text-dim)', padding: '4px 0' }}>
          {showShared ? '−' : '+'} Shared calendars ({sharedCals.length})
        </button>
        {showShared && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
            {sharedErr && <div style={{ color: 'var(--red-bright)', fontSize: '0.8rem' }}>{sharedErr}</div>}

            {/* existing shared calendars */}
            {sharedCals.map(c => (
              <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 14, height: 14, borderRadius: 4, background: c.color, flexShrink: 0, boxShadow: `0 0 6px ${c.color}` }} />
                  <span style={{ fontWeight: 600, flex: 1 }}>{c.name}</span>
                  <button onClick={() => deleteShared(c.id)} style={{ padding: '4px 10px', minHeight: 30, color: 'var(--red-bright)', background: 'transparent' }}>✕</button>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    value={memberEmail[c.id] || ''}
                    onChange={e => setMemberEmail(m => ({ ...m, [c.id]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && addMember(c.id)}
                    placeholder="Add member by email..."
                    style={{ flex: '1 1 220px', minWidth: 0, fontSize: '0.85rem' }}
                  />
                  <button onClick={() => addMember(c.id)} style={{ background: c.color, color: '#000', fontWeight: 600 }}>Invite</button>
                </div>
              </div>
            ))}

            {/* create a shared calendar */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                value={newSharedName}
                onChange={e => setNewSharedName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createShared()}
                placeholder="New shared calendar name..."
                style={{ flex: '1 1 200px', minWidth: 0 }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                color
                <input type="color" value={newSharedColor} onChange={e => setNewSharedColor(e.target.value)} style={{ width: 40, height: 40, padding: 2, minHeight: 0 }} />
              </label>
              <button onClick={createShared} style={{ background: 'var(--red)', color: '#fff', fontWeight: 600 }}>Create</button>
            </div>

            {/* add an event to a shared calendar */}
            {sharedCals.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={sharedForm.calendar_id} onChange={e => setSharedForm(f => ({ ...f, calendar_id: e.target.value }))} style={{ flex: '1 1 140px', minWidth: 0 }}>
                  <option value="">calendar…</option>
                  {sharedCals.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input value={sharedForm.title} onChange={e => setSharedForm(f => ({ ...f, title: e.target.value }))} placeholder="Event title" style={{ flex: '1 1 140px', minWidth: 0 }} />
                <input type="date" value={sharedForm.date} onChange={e => setSharedForm(f => ({ ...f, date: e.target.value }))} style={{ flex: '0 1 150px', minWidth: 0 }} />
                <input type="time" value={sharedForm.start} onChange={e => setSharedForm(f => ({ ...f, start: e.target.value }))} style={{ flex: '0 1 110px', minWidth: 0 }} />
                <input type="time" value={sharedForm.end} onChange={e => setSharedForm(f => ({ ...f, end: e.target.value }))} style={{ flex: '0 1 110px', minWidth: 0 }} />
                <button onClick={addSharedEvent} style={{ background: 'var(--red)', color: '#fff', fontWeight: 600 }}>Add event</button>
              </div>
            )}
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
                  flex: `1 1 0`, minWidth: DAY_COL_W, textAlign: 'center',
                  fontSize: 'clamp(0.78rem, 1.3vw, 0.95rem)', fontWeight: 600,
                  color: i === todayIndex ? 'var(--red)' : 'var(--text-dim)',
                  paddingBottom: 8, borderBottom: `2px solid ${i === todayIndex ? 'var(--red)' : 'var(--border)'}`,
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
                <div key={di} style={{ flex: `1 1 0`, minWidth: DAY_COL_W, position: 'relative', borderLeft: '1px solid var(--border)' }}>
                  {hours.map(h => <div key={h} style={{ height: SLOT_H, borderTop: '1px solid var(--border)' }} />)}
                  {di === todayIndex && <div style={{ position: 'absolute', top: nowTop, left: 0, right: 0, height: 2, background: 'var(--red)', boxShadow: '0 0 6px var(--red)', zIndex: 2 }} />}
                  {eventsForDay(day).map((e, i) => {
                    const top = (e.startM / 60) * SLOT_H
                    return (
                      <div key={e.id || i} style={{ position: 'absolute', top: top + 1, left: 3, right: 3, height: Math.max((e.dur / 60) * SLOT_H - 2, 24), background: e.color, borderRadius: 6, padding: '3px 8px', overflow: 'hidden', zIndex: 1 }}>
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
