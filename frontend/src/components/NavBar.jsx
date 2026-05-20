import { NavLink } from 'react-router-dom'

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
      display: 'flex',
      alignItems: 'center',
      height: 'var(--nav-h)',
      background: 'var(--surface)',
      borderBottom: '2px solid var(--red)',
      padding: '0 12px',
      gap: 4,
    }}>
      <span style={{ color: 'var(--red)', fontWeight: 700, fontSize: 16, marginRight: 12 }}>CUM</span>
      {links.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          style={({ isActive }) => ({
            padding: '8px 14px',
            borderRadius: 6,
            textDecoration: 'none',
            color: isActive ? '#fff' : 'var(--text-dim)',
            background: isActive ? 'var(--red)' : 'transparent',
            fontWeight: isActive ? 600 : 400,
            fontSize: 14,
          })}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
