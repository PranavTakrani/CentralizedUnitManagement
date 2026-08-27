import axios from 'axios'
import { supabase } from './supabase'

// NOTE: VITE_API_URL is inlined at BUILD time by Vite. It must be set in the
// frontend Vercel project's env vars and the deployment must rebuild (not reuse
// build cache) for changes to take effect. Falls back to localhost for dev.
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000' })

// Attach the current user's Supabase JWT so the backend can scope data to
// them (per-user calendars, shared calendars). Without this the backend
// cannot tell who is calling and returns no user-scoped data.
api.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export default api
