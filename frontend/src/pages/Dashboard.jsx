import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { supabase } from '../lib/supabase'

const RADIUS = 40
const CIRC = 2 * Math.PI * RADIUS
const SLOT = 20

function CircleProgress({ val, goal }) {
  const pct = goal ? Math.min(val / goal, 1) : 0
  return (
    <svg width={100} height={100}>
      <circle cx={50} cy={50} r={RADIUS} fill="none" stroke="var(--border)" strokeWidth={8} />
      <circle cx={50} cy={50} r={RADIUS} fill="none" stroke="var(--red)" strokeWidth={8}
        strokeDasharray={`${pct * CIRC} ${CIRC}`} strokeLinecap="round" transform="rotate(-90 50 50)" />
      <text x={50} y={46} textAnchor="middle" fill="var(--text)" fontSize={14} fontWeight={700}>{val}</text>
      <text x={50} y={60} textAnchor="middle" fill="var(--text-dim)" fontSize={10}>/ {goal} cal</text>
    </svg>
  )
}

const todayRange = () => {
  const s = new Date(); s.setHours(0,0,0,0)
  const e = new Date(); e.setHours(23,59,59,999)
  return [s.toISOString(), e.toISOString()]
}

const priorityColor = (p) => p >= 2 ? '#ff2222' : p === 1 ? '#ff8800' : 'var(--text-dim)'

export default function Dashboard() {
  const [events, setEvents] = useState([])
  const [tasks, setTasks] = useState([])
  const [stats, setStats] = useState(null)
  const [cals, setCals] = useState(0)
  const [goals, setGoals] = useState(null)
  const [now, setNow] = useState(new Date())
  const [spotify, setSpotify] = useState(null)
  const navigate = useNavigate()
  const calRef = useRef(null)

  const loadCalendar = () => api.get('/calendar/today').then(r => setEvents(r.data)).catch(() => {})
  const loadSupabase = async () => {
    const [start, end] = todayRange()
    const [{ data: t }, { data: m }, { data: g }] = await Promise.all([
      supabase.from('Tasks').select('*').eq('completed', false).order('due_date').order('priority', { ascending: false }),
      supabase.from('meals').select('calories').gte('logged_at', start).lte('logged_at', end),
      supabase.from('user_settings').select('daily_calories').limit(1).single(),
    ])
    setTasks(t ?? [])
    setCals((m ?? []).reduce((s, r) => s + (r.calories || 0), 0))
    setGoals(g)
  }

  useEffect(() => {
    loadCalendar(); loadSupabase()
    const tick = () => { api.get('/system/').then(r => setStats(r.data)).catch(() => {}); setNow(new Date()) }
    const fetchSpotify = () => api.get('/spotify/now-playing').then(r => setSpotify(r.data)).catch(() => {})
    tick(); fetchSpotify()
    const ids = [setInterval(tick, 5000), setInterval(fetchSpotify, 5000), setInterval(() => { loadCalendar(); loadSupabase() }, 60000)]
    return () => ids.forEach(clearInterval)
  }, [])

  useEffect(() => {
    if (calRef.current) calRef.current.scrollTop = Math.max(0, now.getHours() - 2) * SLOT
  }, [events])

  const startH = Math.max(0, now.getHours() - 2)
  const endH = Math.min(23, now.getHours() + 10)
  const hours = Array.from({ length: endH - startH + 1 }, (_, i) => startH + i)
  const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60 - startH) * SLOT

  return (
    <div style={{ display: 'flex', height: '100%', gap: 10, position: 'relative' }}>

      {/* Left: calendar */}
      <div onClick={() => navigate('/schedule')} style={{ width: 200, display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer' }}>
        <div style={{ color: 'var(--red)', fontWeight: 600, fontSize: 12, flexShrink: 0 }}>TODAY</div>
        <div ref={calRef} style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
          {hours.map(h => (
            <div key={h} style={{ display: 'flex', height: SLOT, borderTop: '1px solid var(--border)' }}>
              <span style={{ width: 26, fontSize: 10, color: 'var(--text-dim)', paddingTop: 2, textAlign: 'right', paddingRight: 4, flexShrink: 0 }}>
                {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h-12}p`}
              </span>
              <div style={{ flex: 1, borderLeft: '1px solid var(--border)' }} />
            </div>
          ))}
          <div style={{ position: 'absolute', left: 26, right: 0, top: nowTop, height: 2, background: 'var(--red)', boxShadow: '0 0 4px var(--red)', zIndex: 2 }} />
          {events.filter(e => e.start).map((e, i) => {
            const d = new Date(e.start)
            const startM = d.getHours() * 60 + d.getMinutes()
            const endD = e.end ? new Date(e.end) : new Date(d.getTime() + 3600000)
            const dur = (endD.getHours() * 60 + endD.getMinutes()) - startM
            const top = (startM / 60 - startH) * SLOT
            if (top < 0 || top > hours.length * SLOT) return null
            return (
              <div key={i} style={{ position: 'absolute', left: 30, right: 2, top: top + 1, height: Math.max((dur / 60) * SLOT - 2, 12), background: 'var(--red)', borderRadius: 3, padding: '1px 4px', overflow: 'hidden', zIndex: 1 }}>
                <div style={{ fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Middle: tasks + music */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
        <div onClick={() => navigate('/assignments')} className="card" style={{ maxHeight: 330, display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer', overflow: 'hidden' }}>
          <div style={{ color: 'var(--red)', fontWeight: 600, fontSize: 12, flexShrink: 0 }}>TASKS ›</div>
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {tasks.length === 0
              ? <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>No tasks</div>
              : tasks.map(t => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexShrink: 0, borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
                  <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.task_name}</span>
                  <span style={{ fontSize: 10, color: priorityColor(t.priority), fontWeight: 600 }}>{['LOW','MED','HI'][t.priority]}</span>
                  {t.due_date && <span style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{new Date(t.due_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>}
                </div>
              ))
            }
          </div>
        </div>
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px', flexShrink: 0, minHeight: 54 }}>
          {spotify?.album_art && <img src={spotify.album_art} alt="" style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{spotify?.track ?? 'Not playing'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{spotify?.artist ?? '—'}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginRight: 4 }}>
            <svg onClick={() => api.post('/spotify/previous').catch(() => {})} width="20" height="20" viewBox="0 0 24 24" fill="var(--text-dim)" style={{ cursor: 'pointer' }}><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
            <svg onClick={() => { api.post('/spotify/play').catch(() => {}); setSpotify(d => d ? { ...d, is_playing: !d.is_playing } : d) }} width="20" height="20" viewBox="0 0 24 24" fill={spotify?.is_playing ? 'var(--red)' : 'var(--text-dim)'} style={{ cursor: 'pointer' }}>
              {spotify?.is_playing
                ? <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                : <path d="M8 5v14l11-7z"/>}
            </svg>
            <svg onClick={() => api.post('/spotify/next').catch(() => {})} width="20" height="20" viewBox="0 0 24 24" fill="var(--text-dim)" style={{ cursor: 'pointer' }}><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          </div>
        </div>
      </div>

      {/* Right: calories + system */}
      <div style={{ width: 180, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div onClick={() => navigate('/calories')} className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <div style={{ color: 'var(--red)', fontWeight: 600, fontSize: 12, alignSelf: 'flex-start' }}>CALORIES</div>
          <CircleProgress val={cals} goal={goals?.daily_calories ?? 0} />
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ color: 'var(--red)', fontWeight: 600, fontSize: 12 }}>SYSTEM</div>
          {stats ? (
            <>
              {[['CPU', `${stats.cpu_percent.toFixed(0)}%`], ['RAM', `${stats.ram_percent.toFixed(0)}%`], ['TEMP', stats.temp ? `${stats.temp}°C` : '—']].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--text-dim)' }}>{l}</span>
                  <span style={{ color: 'var(--red-bright)', fontWeight: 600 }}>{v}</span>
                </div>
              ))}
              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{(stats.ram_used/1073741824).toFixed(1)}G / {(stats.ram_total/1073741824).toFixed(1)}G</div>
            </>
          ) : <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>Loading...</div>}
        </div>
      </div>

    </div>
  )
}
