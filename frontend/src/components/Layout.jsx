import NavBar from './NavBar'
import { Outlet } from 'react-router-dom'

export default function Layout() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '520px', width: '800px' }}>
      <NavBar />
      <main style={{ flex: 1, overflow: 'hidden', padding: 12 }}>
        <Outlet />
      </main>
    </div>
  )
}
