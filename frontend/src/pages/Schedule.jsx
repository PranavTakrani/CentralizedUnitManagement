import { useEffect, useState, useRef } from 'react'
import api from '../lib/api'

const SLOT_H = 48
const GUTTER_W = 52
const DAY_COL_W = 120
const DAYS = 7
const SHARE_COLORS = ['#3ea6ff', '#ffb020', '#8a6dff', '#2fd88a', '#ff5ea3']
const pad = (n) => String(n).padStart(2, '0')
const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x }
const toMins = (iso) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes() }
const fmtDay = (d) => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const colorForShare = (id) => {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return SHARE_COLORS[h % SHARE_COLORS.length]
}

export default function Schedule() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCalendars, setShowCalendars] = useState(false)

  // ---- Google Calendar connection + enabled calendars ----
  const [connected, setConnected] = useState(null) // null = unknown yet
  const [googleCals, setGoogleCals] = useState([])  // [{id,summary,color,primary}]
  const [enabledCals, setEnabledCals] = useState([]) // rows from our own `calendars` table
  const [calErr, setCalErr] = useState(null)

  // ---- sharing calendars with other users ----
  const [showShared, setShowShared] = useState(false)
  const [myShares, setMyShares] = useState([])       // calendars I've sent
  const [sharedWithMe, setSharedWithMe] = useState([]) // calendars sent to me
  const [sharedEvents, setSharedEvents] = useState([])
  const [shareForm, setShareForm] = useState({ calendar_id: '', email: '' })
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

  const loadConnection = async () => {
    try {
      const { data } = await api.get('/calendar/status')
      setConnected(!!data.connected)
      if (data.connected) {
        const { data: cals } = await api.get('/calendar/google-calendars')
        setGoogleCals(Array.isArray(cals) ? cals : [])
      }
    } catch {
      setConnected(false)
    }
  }

  const loadEnabledCalendars = async () => {
    try {
      const { data } = await api.get('/calendar/enabled')
      setEnabledCals(Array.isArray(data) ? data : [])
    } catch {
      setEnabledCals([])
    }
  }

  const loadShared = async () => {
    try {
      const [mine, withMe, evs] = await Promise.all([
        api.get('/calendar/my-shares'),
        api.get('/calendar/shared-with-me'),
        api.get('/calendar/shared-events', { params: { days: DAYS, start: dateStr(weekStart) } }),
      ])
      setMyShares(Array.isArray(mine.data) ? mine.data : [])
      setSharedWithMe(Array.isArray(withMe.data) ? withMe.data : [])
      setSharedEvents(Array.isArray(evs.data) ? evs.data : [])
    } catch {
      setMyShares([]); setSharedWithMe([]); setSharedEvents([])
    }
  }

  const refreshAll = () => {
    api.get('/calendar/upcoming', { params: { days: DAYS, start: dateStr(weekStart) } }).then(r => setEvents(Array.isArray(r.data) ? r.data : [])).catch(() => {}).finally(() => setLoading(false))
    loadConnection()
    loadEnabledCalendars()
    loadShared()
  }

  useEffect(() => {
    refreshAll()
    if (new URLSearchParams(window.location.search).get('connected') === '1') {
      window.history.replaceState({}, '', window.location.pathname)
    }
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

  const connectGoogle = async () => {
    setCalErr(null)
    try {
      const { data } = await api.post('/calendar/oauth/start')
      window.location.href = data.url
    } catch (e) {
      setCalErr(e?.response?.data?.detail || 'could not start Google connect')
    }
  }

  const enabledIds = new Set(enabledCals.map(c => c.calendar_id))

  const toggleCalendar = async (cal) => {
    setCalErr(null)
    try {
      if (enabledIds.has(cal.id)) {
        const row = enabledCals.find(c => c.calendar_id === cal.id)
        await api.delete(`/calendar/enabled/${row.id}`)
      } else {
        await api.post('/calendar/enabled', { calendar_id: cal.id, label: cal.summary })
      }
      await loadEnabledCalendars()
      refreshAll()
    } catch (e) {
      setCalErr(e?.response?.data?.detail || 'could not update calendar')
    }
  }

  // ---- sharing handlers ----
  const shareCalendar = async () => {
    setSharedErr(null)
    const { calendar_id, email } = shareForm
    if (!calendar_id || !email.trim()) { setSharedErr('pick a calendar and enter an email'); return }
    try {
      await api.post('/calendar/share', { calendar_id, email: email.trim() })
      setShareForm(f => ({ ...f, email: '' }))
      loadShared()
    } catch (e) { setSharedErr(e?.response?.data?.detail || 'could not share calendar') }
  }

  const revokeShare = async (id) => {
    try { await api.delete(`/calendar/share/${id}`); loadShared() }
    catch (e) { setSharedErr(e?.response?.data?.detail || 'could not revoke') }
  }

  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d
  })

  const eventsForDay = (day) => {
    const google = events
      .filter(e => e.start && startOfDay(new Date(e.start)).getTime() === day.getTime())
      .map(e => ({ id: `g-${e.title}-${e.start}`, title: e.title, location: e.location, startM: toMins(e.start), dur: e.end ? toMins(e.end) - toMins(e.start) : 60, color: 'var(--red)' }))
    const shared = sharedEvents
      .filter(e => e.start && startOfDay(new Date(e.start)).getTime() === day.getTime())
      .map((e, i) => ({ id: `s-${e.share_id}-${e.start}-${i}`, title: e.label ? `${e.title} (${e.label})` : e.title, location: e.location, startM: toMins(e.start), dur: e.end ? toMins(e.end) - toMins(e.start) : 60, color: colorForShare(e.share_id) }))
    return [...google, ...shared]
  }

  const gridMinWidth = GUTTER_W + DAYS * DAY_COL_W

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 'var(--gap)' }}>
      <div className="card" style={{ flexShrink: 0 }}>
        <button onClick={() => setShowCalendars(v => !v)} style={{ background: 'transparent', color: 'var(--text-dim)', padding: '4px 0' }}>
          {showCalendars ? '−' : '+'} Manage calendars ({enabledCals.length})
        </button>
        {showCalendars && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {calErr && <div style={{ color: 'var(--red-bright)', fontSize: '0.8rem' }}>{calErr}</div>}
            {connected === false && (
              <button onClick={connectGoogle} style={{ background: 'var(--red)', color: '#fff', fontWeight: 600, alignSelf: 'flex-start' }}>
                Connect Google Calendar
              </button>
            )}
            {connected === true && googleCals.length === 0 && (
              <div style={{ color: 'var(--text-dim)' }}>No Google calendars found.</div>
            )}
            {connected === true && googleCals.map(c => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={enabledIds.has(c.id)} onChange={() => toggleCalendar(c)} />
                <span style={{ width: 14, height: 14, borderRadius: 4, background: c.color || 'var(--red)', flexShrink: 0 }} />
                <span style={{ color: 'var(--text)' }}>{c.summary}{c.primary ? ' (primary)' : ''}</span>
              </label>
            ))}
            {connected === true && (
              <button onClick={connectGoogle} style={{ background: 'transparent', color: 'var(--text-dim)', alignSelf: 'flex-start', padding: '4px 0' }}>
                Reconnect Google Calendar
              </button>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ flexShrink: 0 }}>
        <button onClick={() => setShowShared(v => !v)} style={{ background: 'transparent', color: 'var(--text-dim)', padding: '4px 0' }}>
          {showShared ? '−' : '+'} Shared calendars ({sharedWithMe.length})
        </button>
        {showShared && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
            {sharedErr && <div style={{ color: 'var(--red-bright)', fontSize: '0.8rem' }}>{sharedErr}</div>}

            {/* send one of my calendars to a user */}
            <div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: 6 }}>Send a calendar</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={shareForm.calendar_id} onChange={e => setShareForm(f => ({ ...f, calendar_id: e.target.value }))} style={{ flex: '1 1 160px', minWidth: 0 }}>
                  <option value="">calendar…</option>
                  {googleCals.map(c => <option key={c.id} value={c.id}>{c.summary}</option>)}
                </select>
                <input
                  value={shareForm.email}
                  onChange={e => setShareForm(f => ({ ...f, email: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && shareCalendar()}
                  placeholder="Recipient email..."
                  style={{ flex: '1 1 200px', minWidth: 0 }}
                />
                <button onClick={shareCalendar} style={{ background: 'var(--red)', color: '#fff', fontWeight: 600 }}>Send</button>
              </div>
            </div>

            {myShares.length > 0 && (
              <div>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: 6 }}>Calendars I've sent</div>
                {myShares.map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ flex: 1, color: 'var(--text)' }}>{s.label || s.calendar_id}</span>
                    <button onClick={() => revokeShare(s.id)} style={{ padding: '4px 10px', minHeight: 30, color: 'var(--red-bright)', background: 'transparent' }}>✕</button>
                  </div>
                ))}
              </div>
            )}

            {sharedWithMe.length > 0 && (
              <div>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: 6 }}>Shared with me</div>
                {sharedWithMe.map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 14, height: 14, borderRadius: 4, background: colorForShare(s.id), flexShrink: 0 }} />
                    <span style={{ flex: 1, color: 'var(--text)' }}>{s.label || s.calendar_id}</span>
                  </div>
                ))}
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
