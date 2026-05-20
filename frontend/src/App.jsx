import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Assignments from './pages/Assignments'
import Schedule from './pages/Schedule'
import Calories from './pages/Calories'
import Spotify from './pages/Spotify'

export default function App() {
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
