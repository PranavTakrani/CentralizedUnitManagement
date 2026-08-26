import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '480px', width: '800px', background: 'var(--bg)',
    }}>
      <form onSubmit={handleSubmit} className="card" style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ color: 'var(--red)', fontWeight: 700, fontSize: 18, textAlign: 'center' }}>CUM</div>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          required
          style={{
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
            padding: '8px 10px', color: 'var(--text)', fontSize: 13,
          }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
            padding: '8px 10px', color: 'var(--text)', fontSize: 13,
          }}
        />
        {error && <div style={{ color: '#ff2222', fontSize: 12 }}>{error}</div>}
        <button
          type="submit"
          disabled={busy}
          style={{
            background: 'var(--red)', border: 'none', borderRadius: 6, padding: '8px 10px',
            color: '#fff', fontWeight: 600, fontSize: 13, cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
