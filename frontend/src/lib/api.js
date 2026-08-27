import axios from 'axios'
import { supabase } from './supabase'

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
