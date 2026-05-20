import { useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Assignments from './pages/Assignments'
import Schedule from './pages/Schedule'
import Calories from './pages/Calories'
import Spotify from './pages/Spotify'

function getAngle(t1, t2) {
  return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * (180 / Math.PI)
}

export default function App() {
  const rotation = useRef(0)
  const startAngle = useRef(null)

  useEffect(() => {
    const el = document.getElementById('root')

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        startAngle.current = getAngle(e.touches[0], e.touches[1])
      }
    }

    const onTouchMove = (e) => {
      if (e.touches.length === 2 && startAngle.current !== null) {
        const current = getAngle(e.touches[0], e.touches[1])
        const delta = current - startAngle.current
        rotation.current = (rotation.current + delta) % 360
        startAngle.current = current
        el.style.transform = `rotate(${rotation.current}deg)`
        el.style.transformOrigin = 'center center'
      }
    }

    const onTouchEnd = (e) => {
      if (e.touches.length < 2) startAngle.current = null
    }

    window.addEventListener('touchstart', onTouchStart)
    window.addEventListener('touchmove', onTouchMove)
    window.addEventListener('touchend', onTouchEnd)
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="assignments" element={<Assignments />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="calories" element={<Calories />} />
          <Route path="spotify" element={<Spotify />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
