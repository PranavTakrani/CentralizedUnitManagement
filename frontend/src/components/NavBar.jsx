import { NavLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/assignments', label: 'Assignments' },
  { to: '/schedule', label: 'Schedule' },
  { to: '/calories', label: 'Calories' },
  { to: '/spotify', label: 'Spotify' },
]

export default function NavBar() {
  return (
    <nav style={{
      position: 'sticky',
      top: 0,
      zIndex: 50,
      background: 'var(--surface)',
      borderBottom: '2px solid var(--red)',
      paddingTop: 'env(safe-area-inset-top)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 'var(--nav-h)',
        width: '100%',
        maxWidth: 'var(--max-w)',
        margin: '0 auto',
        padding: '0 var(--gutter)',
        overflowX: 'auto',
        scrollbarWidth: 'none',
      }}>
        <span style={{
          color: 'var(--red)',
          fontWeight: 800,
          fontSize: 'clamp(1.1rem, 2.2vw, 1.5rem)',
          letterSpacing: '0.06em',
          marginRight: 'clamp(8px, 1.5vw, 20px)',
          flexShrink: 0,
        }}>
          CUM
        </span>
        {links.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            style={({ isActive }) => ({
              padding: '0.55em 0.95em',
              borderRadius: 'var(--radius)',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              color: isActive ? '#fff' : 'var(--text-dim)',
              background: isActive ? 'var(--red)' : 'transparent',
              fontWeight: isActive ? 600 : 400,
              fontSize: 'clamp(0.85rem, 1.3vw, 1rem)',
            })}
          >
            {label}
          </NavLink>
        ))}
        <button
          onClick={() => supabase.auth.signOut()}
          style={{
            marginLeft: 'auto',
            flexShrink: 0,
            background: 'transparent',
            border: '1px solid var(--border)',
            padding: '0.45em 0.9em',
            minHeight: 0,
            color: 'var(--text-dim)',
            fontSize: 'clamp(0.75rem, 1.1vw, 0.9rem)',
            whiteSpace: 'nowrap',
          }}
        >
          Log out
        </button>
      </div>
    </nav>
  )
}
