import NavBar from './NavBar'
import { Outlet } from 'react-router-dom'

export default function Layout() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '480px', width: '800px' }}>
      <NavBar />
      <main style={{ flex: 1, overflow: 'hidden', padding: 12, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
