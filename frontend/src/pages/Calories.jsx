import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const todayRange = () => {
  const start = new Date(); start.setHours(0,0,0,0)
  const end = new Date(); end.setHours(23,59,59,999)
  return [start.toISOString(), end.toISOString()]
}

const emptyForm = { meals: '', protein_g: '', carbs_g: '', fat_g: '', servings: '1' }

const RADIUS = 54
const CIRC = 2 * Math.PI * RADIUS

function CircleProgress({ val, goal, label }) {
  const pct = goal ? Math.min(val / goal, 1) : 0
  const dash = pct * CIRC
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={130} height={130}>
        <circle cx={65} cy={65} r={RADIUS} fill="none" stroke="var(--border)" strokeWidth={10} />
        <circle cx={65} cy={65} r={RADIUS} fill="none" stroke="var(--red)" strokeWidth={10}
          strokeDasharray={`${dash} ${CIRC}`} strokeLinecap="round"
          transform="rotate(-90 65 65)" />
        <text x={65} y={60} textAnchor="middle" fill="var(--text)" fontSize={18} fontWeight={700}>{val}</text>
        <text x={65} y={78} textAnchor="middle" fill="var(--text-dim)" fontSize={11}>/ {goal}</text>
        <text x={65} y={94} textAnchor="middle" fill="var(--text-dim)" fontSize={10}>{label}</text>
      </svg>
    </div>
  )
}

function MacroBar({ label, val, goal, color }) {
  const pct = goal ? Math.min((val / goal) * 100, 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 32, fontSize: 11, color: 'var(--text-dim)' }}>{label}</span>
      <div style={{ flex: 1, background: 'var(--border)', borderRadius: 4, height: 14, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.3s' }} />
      </div>
      <span style={{ width: 60, fontSize: 11, color: 'var(--text-dim)', textAlign: 'right' }}>{val} / {goal}</span>
    </div>
  )
}

export default function Calories() {
  const [log, setLog] = useState([])
  const [goals, setGoals] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const load = async () => {
    const [start, end] = todayRange()
    const [{ data: meals }, { data: settings }] = await Promise.all([
      supabase.from('meals').select('*').gte('logged_at', start).lte('logged_at', end).order('logged_at'),
      supabase.from('user_settings').select('*').limit(1).single()
    ])
    setLog(meals ?? [])
    setGoals(settings)
  }

  useEffect(() => { load() }, [])

  const s = Number(form.servings) || 1
  const calcCals = Math.round(((Number(form.protein_g) || 0) * 4 + (Number(form.carbs_g) || 0) * 4 + (Number(form.fat_g) || 0) * 9) * s)

  const add = async () => {
    if (!form.meals.trim()) return
    await supabase.from('meals').insert({
      meals: form.meals,
      calories: calcCals,
      protein_g: Math.round((Number(form.protein_g) || 0) * s),
      carbs_g: Math.round((Number(form.carbs_g) || 0) * s),
      fat_g: Math.round((Number(form.fat_g) || 0) * s),
      serving_size: `${s} serving${s !== 1 ? 's' : ''}`,
    })
    setForm(emptyForm); load()
  }

  const remove = async (id) => { await supabase.from('meals').delete().eq('id', id); load() }

  const totals = log.reduce((acc, r) => ({
    calories: acc.calories + (r.calories || 0),
    protein_g: acc.protein_g + (r.protein_g || 0),
    carbs_g: acc.carbs_g + (r.carbs_g || 0),
    fat_g: acc.fat_g + (r.fat_g || 0),
  }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 })

  const inp = (key, placeholder, width = 60) => (
    <input
      value={form[key]}
      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
      placeholder={placeholder}
      type={key === 'meals' ? 'text' : 'number'}
      style={{ width, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 8px', color: 'var(--text)', fontSize: 13 }}
    />
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      {/* Chart widget */}
      <div className="card" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <CircleProgress val={totals.calories} goal={goals?.daily_calories ?? 0} label="kcal" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <MacroBar label="Pro" val={totals.protein_g} goal={goals?.daily_protein_g ?? 0} color="#cc0000" />
          <MacroBar label="Carb" val={totals.carbs_g} goal={goals?.daily_carbs_g ?? 0} color="#ff6600" />
          <MacroBar label="Fat" val={totals.fat_g} goal={goals?.daily_fat_g ?? 0} color="#ffaa00" />
        </div>
      </div>

      {/* Add form */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {inp('meals', 'Food name...', 150)}
        {inp('protein_g', 'Pro')}
        {inp('carbs_g', 'Carb')}
        {inp('fat_g', 'Fat')}
        {inp('servings', 'Servings', 70)}
        <span style={{ color: 'var(--text-dim)', fontSize: 12, whiteSpace: 'nowrap' }}>{calcCals} cal</span>
        <button onClick={add} style={{ background: 'var(--red)', color: '#fff', fontWeight: 600, padding: '7px 14px' }}>Add</button>
      </div>

      {/* Log */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {log.map(r => (
          <div key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ flex: 1 }}>{r.meals}</span>
            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{r.serving_size}</span>
            <span style={{ color: 'var(--red-bright)', fontWeight: 600, minWidth: 45 }}>{r.calories} cal</span>
            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{r.protein_g}p {r.carbs_g}c {r.fat_g}f</span>
            <button onClick={() => remove(r.id)} style={{ padding: '3px 8px', color: 'var(--red-bright)', background: 'transparent' }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}
