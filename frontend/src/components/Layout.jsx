import NavBar from './NavBar'
import { Outlet } from 'react-router-dom'

export default function Layout() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <NavBar />
      <main
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 'var(--max-w)',
          margin: '0 auto',
          padding: 'var(--gutter)',
          paddingBottom: 'calc(var(--gutter) + env(safe-area-inset-bottom))',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
