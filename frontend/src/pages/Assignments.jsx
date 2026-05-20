import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const pad = (n) => String(n).padStart(2, '0')

const localDateStr = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const getDateOptions = () => {
  const opts = []
  for (let i = 0; i < 14; i++) {
    const d = new Date(); d.setDate(d.getDate() + i); d.setHours(0,0,0,0)
    opts.push({ label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }), value: localDateStr(d) })
  }
  return opts
}

export default function Assignments() {
  const now = new Date()
  const [items, setItems] = useState([])
  const [name, setName] = useState('')
  const [dueDate, setDueDate] = useState(localDateStr())
  const [dueHour, setDueHour] = useState(now.getHours() % 12 || 12)
  const [dueMin, setDueMin] = useState(Math.floor(now.getMinutes() / 5) * 5)
  const [ampm, setAmpm] = useState(now.getHours() < 12 ? 'AM' : 'PM')
  const [priority, setPriority] = useState(0)

  const load = async () => {
    const { data, error } = await supabase.from('Tasks').select('*').order('due_date').order('priority', { ascending: false })
    if (error) console.error('Tasks load error:', error)
    setItems(data ?? [])
  }

  useEffect(() => { load() }, [])

  const add = async () => {
    if (!name.trim()) return
    const h24 = (Number(dueHour) % 12) + (ampm === 'PM' ? 12 : 0)
    const [y, mo, d] = dueDate.split('-').map(Number)
    const dt = new Date(y, mo - 1, d, h24, Number(dueMin), 0)
    const { error } = await supabase.from('Tasks').insert({
      task_name: name, due_date: dt.toISOString(), priority: Number(priority),
    })
    if (error) { console.error('Insert error:', error); return }
    setName(''); setPriority(0); load()
  }

  const toggle = async (id, completed) => {
    await supabase.from('Tasks').update({ completed: !completed }).eq('id', id)
    load()
  }

  const remove = async (id) => {
    await supabase.from('Tasks').delete().eq('id', id)
    load()
  }

  const priorityColor = (p) => p >= 2 ? '#ff2222' : p === 1 ? '#ff8800' : 'var(--text-dim)'
  const selectStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', color: 'var(--text)', fontSize: 14 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Task name..."
          style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', color: 'var(--text)', fontSize: 14 }}
        />
        <select value={dueDate} onChange={e => setDueDate(e.target.value)} style={selectStyle}>
          {getDateOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={dueHour} onChange={e => setDueHour(e.target.value)} style={{...selectStyle, width: 60}}>
          {Array.from({length: 12}, (_, i) => i + 1).map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <span style={{ color: 'var(--text-dim)', alignSelf: 'center' }}>:</span>
        <select value={dueMin} onChange={e => setDueMin(e.target.value)} style={{...selectStyle, width: 60}}>
          {[0,5,10,15,20,25,30,35,40,45,50,55].map(m => <option key={m} value={m}>{pad(m)}</option>)}
        </select>
        <select value={ampm} onChange={e => setAmpm(e.target.value)} style={{...selectStyle, width: 65}}>
          <option>AM</option>
          <option>PM</option>
        </select>
        <select value={priority} onChange={e => setPriority(e.target.value)} style={selectStyle}>
          <option value={0}>Low</option>
          <option value={1}>Med</option>
          <option value={2}>High</option>
        </select>
        <button onClick={add} style={{ background: 'var(--red)', color: '#fff', fontWeight: 600 }}>Add</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map(item => (
          <div key={item.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => toggle(item.id, item.completed)}
              style={{ width: 28, height: 28, padding: 0, background: item.completed ? 'var(--red)' : 'var(--border)', borderRadius: 4, fontSize: 16, flexShrink: 0 }}
            >
              {item.completed ? '✓' : ''}
            </button>
            <span style={{ flex: 1, textDecoration: item.completed ? 'line-through' : 'none', color: item.completed ? 'var(--text-dim)' : 'var(--text)' }}>
              {item.task_name}
            </span>
            {item.due_date && (
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                {new Date(item.due_date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <span style={{ color: priorityColor(item.priority), fontSize: 11, fontWeight: 600, minWidth: 28 }}>
              {['LOW', 'MED', 'HI'][item.priority] ?? ''}
            </span>
            <button onClick={() => remove(item.id)} style={{ padding: '4px 10px', color: 'var(--red-bright)', background: 'transparent' }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}
