import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

import { todayRange } from '../lib/todayRange'

const emptyForm = { meals: '', protein_g: '', carbs_g: '', fat_g: '', servings: '1' }

const RADIUS = 54
const CIRC = 2 * Math.PI * RADIUS

function CircleProgress({ val, goal, label }) {
  const pct = goal ? Math.min(val / goal, 1) : 0
  const dash = pct * CIRC
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg viewBox="0 0 130 130" style={{ width: 'clamp(130px, 18vw, 180px)', height: 'auto' }}>
        <circle cx={65} cy={65} r={RADIUS} fill="none" stroke="var(--border)" strokeWidth={10} />
        <circle cx={65} cy={65} r={RADIUS} fill="none" stroke="var(--red)" strokeWidth={10}
          strokeDasharray={`${dash} ${CIRC}`} strokeLinecap="round"
          transform="rotate(-90 65 65)" />
        <text x={65} y={60} textAnchor="middle" fill="var(--text)" fontSize={22} fontWeight={700}>{val}</text>
        <text x={65} y={79} textAnchor="middle" fill="var(--text-dim)" fontSize={13}>/ {goal}</text>
        <text x={65} y={96} textAnchor="middle" fill="var(--text-dim)" fontSize={12}>{label}</text>
      </svg>
    </div>
  )
}

function MacroBar({ label, val, goal, color }) {
  const pct = goal ? Math.min((val / goal) * 100, 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ width: 44, fontSize: '0.85rem', color: 'var(--text-dim)' }}>{label}</span>
      <div style={{ flex: 1, background: 'var(--border)', borderRadius: 6, height: 18, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 6, transition: 'width 0.3s' }} />
      </div>
      <span style={{ width: 82, fontSize: '0.85rem', color: 'var(--text-dim)', textAlign: 'right', whiteSpace: 'nowrap' }}>{val} / {goal}</span>
    </div>
  )
}

export default function Calories() {
  const [log, setLog] = useState([])
  const [goals, setGoals] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [suggestions, setSuggestions] = useState([])
  const [showSug, setShowSug] = useState(false)

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

  const searchMeals = async (q) => {
    if (!q.trim()) { setSuggestions([]); return }
    const { data } = await supabase.from('meals').select('meals, protein_g, carbs_g, fat_g, serving_size').ilike('meals', `%${q}%`).order('logged_at', { ascending: false }).limit(8)
    const seen = new Set()
    setSuggestions((data ?? []).filter(r => { if (seen.has(r.meals)) return false; seen.add(r.meals); return true }))
  }

  const pickSuggestion = (r) => {
    const srv = parseFloat(r.serving_size) || 1
    setForm({ meals: r.meals, protein_g: String(Math.round(r.protein_g / srv)), carbs_g: String(Math.round(r.carbs_g / srv)), fat_g: String(Math.round(r.fat_g / srv)), servings: '1' })
    setSuggestions([]); setShowSug(false)
  }

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

  const inp = (key, placeholder, width = 90) => (
    <input
      value={form[key]}
      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
      placeholder={placeholder}
      type={key === 'meals' ? 'text' : 'number'}
      style={{ width }}
    />
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 'var(--gap)' }}>
      {/* Chart widget */}
      <div className="card" style={{ display: 'flex', gap: 'clamp(16px, 3vw, 32px)', alignItems: 'center', flexWrap: 'wrap' }}>
        <CircleProgress val={totals.calories} goal={goals?.daily_calories ?? 0} label="kcal" />
        <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <MacroBar label="Pro" val={totals.protein_g} goal={goals?.daily_protein_g ?? 0} color="#cc0000" />
          <MacroBar label="Carb" val={totals.carbs_g} goal={goals?.daily_carbs_g ?? 0} color="#ff6600" />
          <MacroBar label="Fat" val={totals.fat_g} goal={goals?.daily_fat_g ?? 0} color="#ffaa00" />
        </div>
      </div>

      {/* Add form */}
      <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 0 }}>
          <input
            value={form.meals}
            onChange={e => { setForm(f => ({ ...f, meals: e.target.value })); searchMeals(e.target.value); setShowSug(true) }}
            onBlur={() => setTimeout(() => setShowSug(false), 150)}
            onFocus={() => form.meals && setShowSug(true)}
            placeholder="Food name..."
            type="text"
            style={{ width: '100%' }}
          />
          {showSug && suggestions.length > 0 && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 99, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', minWidth: '100%', maxWidth: 340, boxShadow: '0 6px 18px #000a' }}>
              {suggestions.map((r, i) => (
                <div key={i} onMouseDown={() => pickSuggestion(r)} style={{ padding: '12px 14px', cursor: 'pointer', fontSize: '0.9rem', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 600 }}>{r.meals}</span>
                  <span style={{ color: 'var(--text-dim)', marginLeft: 8 }}>{r.protein_g}p {r.carbs_g}c {r.fat_g}f</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {inp('protein_g', 'Pro')}
        {inp('carbs_g', 'Carb')}
        {inp('fat_g', 'Fat')}
        {inp('servings', 'Servings', 100)}
        <span style={{ color: 'var(--text-dim)', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>{calcCals} cal</span>
        <button onClick={add} style={{ background: 'var(--red)', color: '#fff', fontWeight: 600 }}>Add</button>
      </div>

      {/* Log */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {log.map(r => (
          <div key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 140px', minWidth: 0 }}>{r.meals}</span>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{r.serving_size}</span>
            <span style={{ color: 'var(--red-bright)', fontWeight: 700, minWidth: 70, whiteSpace: 'nowrap' }}>{r.calories} cal</span>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{r.protein_g}p {r.carbs_g}c {r.fat_g}f</span>
            <button onClick={() => remove(r.id)} style={{ padding: '6px 12px', minHeight: 34, color: 'var(--red-bright)', background: 'transparent' }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}
