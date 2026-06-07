import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const todayRange = () => {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  return [start.toISOString(), end.toISOString()]
}

const empty = { meals: '', protein_g: '', carbs_g: '', fat_g: '', servings: '1' }
const inp = (val, onChange, placeholder, type = 'number', width = 58) => (
  <input value={val} onChange={onChange} placeholder={placeholder} type={type}
    style={{ width, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 8px', color: 'var(--text)', fontSize: 13 }}
  />
)

export default function Meals() {
  const [log, setLog] = useState([])
  const [form, setForm] = useState(empty)
  const [status, setStatus] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [showSug, setShowSug] = useState(false)

  const load = async () => {
    const [start, end] = todayRange()
    const { data } = await supabase.from('meals').select('*').gte('logged_at', start).lte('logged_at', end).order('logged_at')
    setLog(data ?? [])
  }

  useEffect(() => { load() }, [])

  const searchMeals = async (q) => {
    if (!q.trim()) { setSuggestions([]); return }
    const { data } = await supabase.from('meals').select('meals, protein_g, carbs_g, fat_g, serving_size').ilike('meals', `%${q}%`).order('logged_at', { ascending: false }).limit(8)
    // dedupe by meal name, keep most recent macros
    const seen = new Set()
    setSuggestions((data ?? []).filter(r => { if (seen.has(r.meals)) return false; seen.add(r.meals); return true }))
  }

  const pickSuggestion = (r) => {
    // parse servings back out of serving_size string (e.g. "2 servings")
    const srv = parseFloat(r.serving_size) || 1
    setForm({ meals: r.meals, protein_g: String(Math.round(r.protein_g / srv)), carbs_g: String(Math.round(r.carbs_g / srv)), fat_g: String(Math.round(r.fat_g / srv)), servings: '1' })
    setSuggestions([]); setShowSug(false)
  }
  const f = (key) => ({ value: form[key], onChange: e => setForm(p => ({ ...p, [key]: e.target.value })) })
  const s = Number(form.servings) || 1
  const calcCals = Math.round(((Number(form.protein_g) || 0) * 4 + (Number(form.carbs_g) || 0) * 4 + (Number(form.fat_g) || 0) * 9) * s)

  const add = async () => {
    if (!form.meals.trim()) return
    const { error } = await supabase.from('meals').insert({
      meals: form.meals,
      calories: calcCals,
      protein_g: Math.round((Number(form.protein_g) || 0) * s),
      carbs_g: Math.round((Number(form.carbs_g) || 0) * s),
      fat_g: Math.round((Number(form.fat_g) || 0) * s),
      serving_size: `${s} serving${s !== 1 ? 's' : ''}`,
    })
    if (error) { setStatus('Error: ' + error.message); return }
    setForm(empty); setStatus('✓ Logged'); setTimeout(() => setStatus(''), 2000); load()
  }

  const remove = async (id) => { await supabase.from('meals').delete().eq('id', id); load() }

  const totals = log.reduce((acc, r) => ({
    cal: acc.cal + (r.calories || 0),
    p: acc.p + (r.protein_g || 0),
    c: acc.c + (r.carbs_g || 0),
    f: acc.f + (r.fat_g || 0),
  }), { cal: 0, p: 0, c: 0, f: 0 })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      {/* Totals bar */}
      <div className="card" style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '8px 12px' }}>
        <span style={{ fontWeight: 700, color: 'var(--red)', fontSize: 20 }}>{totals.cal}</span>
        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>kcal</span>
        <div style={{ flex: 1, display: 'flex', gap: 12, fontSize: 12 }}>
          <span><b style={{ color: '#cc4444' }}>{totals.p}g</b> protein</span>
          <span><b style={{ color: '#ff6600' }}>{totals.c}g</b> carbs</span>
          <span><b style={{ color: '#ffaa00' }}>{totals.f}g</b> fat</span>
        </div>
      </div>

      {/* Add form */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', position: 'relative' }}>
        <div style={{ position: 'relative' }}>
          <input
            value={form.meals}
            onChange={e => { setForm(p => ({ ...p, meals: e.target.value })); searchMeals(e.target.value); setShowSug(true) }}
            onBlur={() => setTimeout(() => setShowSug(false), 150)}
            onFocus={() => form.meals && setShowSug(true)}
            placeholder="Food name..."
            type="text"
            style={{ width: 140, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', color: 'var(--text)', fontSize: 13 }}
          />
          {showSug && suggestions.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 99, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, minWidth: 200, boxShadow: '0 4px 12px #0008' }}>
              {suggestions.map((r, i) => (
                <div key={i} onMouseDown={() => pickSuggestion(r)} style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 600 }}>{r.meals}</span>
                  <span style={{ color: 'var(--text-dim)', marginLeft: 8 }}>{r.protein_g}p {r.carbs_g}c {r.fat_g}f</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {inp(form.protein_g, e => setForm(p => ({ ...p, protein_g: e.target.value })), 'Pro')}
        {inp(form.carbs_g, e => setForm(p => ({ ...p, carbs_g: e.target.value })), 'Carb')}
        {inp(form.fat_g, e => setForm(p => ({ ...p, fat_g: e.target.value })), 'Fat')}
        {inp(form.servings, e => setForm(p => ({ ...p, servings: e.target.value })), 'Srv', 'number', 48)}
        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{calcCals} cal</span>
        <button onClick={add} style={{ background: 'var(--red)', color: '#fff', fontWeight: 600, padding: '7px 14px' }}>Add</button>
      </div>

      {status && <span style={{ color: 'var(--red)', fontSize: 12 }}>{status}</span>}

      {/* Log */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {log.map(r => (
          <div key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ flex: 1 }}>{r.meals}</span>
            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{r.serving_size}</span>
            <span style={{ color: 'var(--red-bright)', fontWeight: 600, minWidth: 45 }}>{r.calories} cal</span>
            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{r.protein_g}p {r.carbs_g}c {r.fat_g}f</span>
            <button onClick={() => remove(r.id)} style={{ padding: '3px 8px', color: 'var(--red-bright)', background: 'transparent', fontSize: 12 }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}
