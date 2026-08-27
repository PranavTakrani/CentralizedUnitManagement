import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { supabase } from '../lib/supabase'

const RADIUS = 62
const CIRC = 2 * Math.PI * RADIUS
const SLOT = 34
const HOUR_COL = 40

function CircleProgress({ val, goal }) {
  const pct = goal ? Math.min(val / goal, 1) : 0
  return (
    <svg viewBox="0 0 150 150" style={{ width: '100%', maxWidth: 160, height: 'auto' }}>
      <circle cx={75} cy={75} r={RADIUS} fill="none" stroke="var(--border)" strokeWidth={12} />
      <circle cx={75} cy={75} r={RADIUS} fill="none" stroke="var(--red)" strokeWidth={12}
        strokeDasharray={`${pct * CIRC} ${CIRC}`} strokeLinecap="round" transform="rotate(-90 75 75)" />
      <text x={75} y={72} textAnchor="middle" fill="var(--text)" fontSize={28} fontWeight={700}>{val}</text>
      <text x={75} y={94} textAnchor="middle" fill="var(--text-dim)" fontSize={14}>/ {goal} cal</text>
    </svg>
  )
}

function MacroBar({ label, val, goal, color }) {
  const pct = goal ? Math.min((val / goal) * 100, 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 30, fontSize: '0.75rem', color: 'var(--text-dim)' }}>{label}</span>
      <div style={{ flex: 1, background: 'var(--border)', borderRadius: 6, height: 10, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 6 }} />
      </div>
      <span style={{ width: 56, fontSize: '0.72rem', color: 'var(--text-dim)', textAlign: 'right', whiteSpace: 'nowrap' }}>{val}/{goal}</span>
    </div>
  )
}

import { todayRange } from '../lib/todayRange'

const priorityColor = (p) => p >= 2 ? '#ff2222' : p === 1 ? '#ff8800' : 'var(--text-dim)'

export default function Dashboard() {
  const [events, setEvents] = useState([])
  const [tasks, setTasks] = useState([])
  const [meals, setMeals] = useState([])
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
      supabase.from('meals').select('*').gte('logged_at', start).lte('logged_at', end).order('logged_at', { ascending: false }),
      supabase.from('user_settings').select('*').limit(1).maybeSingle(),
    ])
    setTasks(t ?? [])
    setMeals(m ?? [])
    setGoals(g)
  }

  useEffect(() => {
    loadCalendar(); loadSupabase()
    const tick = () => setNow(new Date())
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
  const cals = meals.reduce((s, r) => s + (r.calories || 0), 0)
  const protein = meals.reduce((s, r) => s + (r.protein_g || 0), 0)
  const carbs = meals.reduce((s, r) => s + (r.carbs_g || 0), 0)
  const fat = meals.reduce((s, r) => s + (r.fat_g || 0), 0)
  const goal = goals?.daily_calories ?? 0
  const remaining = Math.max(goal - cals, 0)

  return (
    <div className="dash-grid">

      {/* Left: calendar */}
      <div
        onClick={() => navigate('/schedule')}
        className="card dash-cal"
        style={{ display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer', minHeight: 0 }}
      >
        <div className="panel-title">Today ›</div>
        <div ref={calRef} style={{ flex: 1, overflowY: 'auto', position: 'relative', minHeight: 0 }}>
          <div style={{ position: 'relative', minHeight: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            {hours.map(h => (
              <div key={h} style={{ display: 'flex', flex: 1, minHeight: SLOT, borderTop: '1px solid var(--border)' }}>
                <span style={{ width: HOUR_COL, fontSize: '0.75rem', color: 'var(--text-dim)', paddingTop: 2, textAlign: 'right', paddingRight: 8, flexShrink: 0 }}>
                  {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h-12}p`}
                </span>
                <div style={{ flex: 1, borderLeft: '1px solid var(--border)' }} />
              </div>
            ))}
            <div style={{ position: 'absolute', left: HOUR_COL, right: 0, top: `${(nowTop / (hours.length * SLOT)) * 100}%`, height: 2, background: 'var(--red)', boxShadow: '0 0 6px var(--red)', zIndex: 2 }} />
            {events.filter(e => e.start).map((e, i) => {
              const d = new Date(e.start)
              const startM = d.getHours() * 60 + d.getMinutes()
              const endD = e.end ? new Date(e.end) : new Date(d.getTime() + 3600000)
              const dur = (endD.getHours() * 60 + endD.getMinutes()) - startM
              const topPx = (startM / 60 - startH) * SLOT
              const total = hours.length * SLOT
              if (topPx < 0 || topPx > total) return null
              return (
                <div key={i} style={{ position: 'absolute', left: HOUR_COL + 4, right: 2, top: `${(topPx / total) * 100}%`, height: `${(Math.max((dur / 60) * SLOT - 2, 20) / total) * 100}%`, background: 'var(--red)', borderRadius: 5, padding: '2px 7px', overflow: 'hidden', zIndex: 1 }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Middle: tasks + music */}
      <div className="dash-col">
        <div
          onClick={() => navigate('/assignments')}
          className="card dash-tasks"
          style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer', overflow: 'hidden', minHeight: 0 }}
        >
          <div className="panel-title">Tasks ›</div>
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {tasks.length === 0
              ? <div style={{ color: 'var(--text-dim)' }}>No tasks</div>
              : tasks.map(t => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexShrink: 0, borderBottom: '1px solid var(--border)', padding: '10px 0' }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.task_name}</span>
                  <span style={{ fontSize: '0.75rem', color: priorityColor(t.priority), fontWeight: 700, letterSpacing: '0.05em' }}>{['LOW','MED','HI'][t.priority]}</span>
                  {t.due_date && <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{new Date(t.due_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>}
                </div>
              ))
            }
          </div>
        </div>

        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, flexWrap: 'wrap' }}>
          {spotify?.album_art && <img src={spotify.album_art} alt="" style={{ width: 56, height: 56, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 120 }}>
            <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{spotify?.track ?? 'Not playing'}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{spotify?.artist ?? '—'}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <svg onClick={() => api.post('/spotify/previous').catch(() => {})} width="28" height="28" viewBox="0 0 24 24" fill="var(--text-dim)" style={{ cursor: 'pointer' }}><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
            <svg onClick={() => { api.post('/spotify/play').catch(() => {}); setSpotify(d => d ? { ...d, is_playing: !d.is_playing } : d) }} width="34" height="34" viewBox="0 0 24 24" fill={spotify?.is_playing ? 'var(--red)' : 'var(--text-dim)'} style={{ cursor: 'pointer' }}>
              {spotify?.is_playing
                ? <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                : <path d="M8 5v14l11-7z"/>}
            </svg>
            <svg onClick={() => api.post('/spotify/next').catch(() => {})} width="28" height="28" viewBox="0 0 24 24" fill="var(--text-dim)" style={{ cursor: 'pointer' }}><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          </div>
        </div>
      </div>

      {/* Right: calories */}
      <div className="dash-col">
        <div
          onClick={() => navigate('/calories')}
          className="card"
          style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, cursor: 'pointer', minHeight: 0 }}
        >
          <div className="panel-title">Calories ›</div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <CircleProgress val={cals} goal={goal} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--red-bright)', fontWeight: 700, fontSize: '1.05rem' }}>{remaining}</div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', letterSpacing: '0.06em' }}>REMAINING</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
            <MacroBar label="Pro" val={protein} goal={goals?.daily_protein_g ?? 0} color="#cc0000" />
            <MacroBar label="Carb" val={carbs} goal={goals?.daily_carbs_g ?? 0} color="#ff6600" />
            <MacroBar label="Fat" val={fat} goal={goals?.daily_fat_g ?? 0} color="#ffaa00" />
          </div>

          {meals.length > 0 && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', letterSpacing: '0.06em', flexShrink: 0 }}>RECENT</div>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {meals.slice(0, 6).map(m => (
                  <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.8rem', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.meals}</span>
                    <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>{m.calories} cal</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
