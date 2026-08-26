import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// --- HTTP-transaction design tokens -----------------------------------------
// Swagger/OpenAPI-style method palette. This is what makes the log read like
// an API console instead of a chat.
const METHOD_COLORS = {
  POST:   '#49cc90', // green  — new message
  PATCH:  '#fca130', // amber  — edit
  DELETE: '#f93e3e', // red    — soft-delete tombstone
  GET:    '#61affe', // blue   — read
}

// Tappable status codes replace emoji reactions.
const STATUS_CODES = [
  { code: 200, label: 'OK · like',        color: '#49cc90' },
  { code: 201, label: 'Created · great',  color: '#3ea6ff' },
  { code: 404, label: 'Not Found · ignored', color: '#888' },
  { code: 429, label: 'Too Many · spam',  color: '#fca130' },
  { code: 500, label: 'Server Error · rage', color: '#f93e3e' },
  { code: 418, label: "I'm a teapot",      color: '#c678dd' },
]

const MONO = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, 'SF Mono', Menlo, Consolas, monospace"

const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

// Deterministic fake latency so a message consistently shows "· 38ms" etc.
const latencyFor = (id) => {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff
  return 12 + (h % 180)
}

export default function Blow() {
  const { session } = useAuth()
  const me = session?.user?.id
  const myEmail = session?.user?.email

  const [conversations, setConversations] = useState([])
  const [peers, setPeers] = useState({})          // profileId -> {email, display_name}
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [reactions, setReactions] = useState({})  // messageId -> [{code,user_id}]
  const [receipts, setReceipts] = useState([])     // read_receipts for active convo
  const [presence, setPresence] = useState('101 Switching Protocols')

  const [draftMethod, setDraftMethod] = useState('POST')
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [sending, setSending] = useState(false)

  const [newEmail, setNewEmail] = useState('')
  const [lookupState, setLookupState] = useState(null) // {type:'error'|'ok', msg}
  const [expanded, setExpanded] = useState({})          // messageId -> bool (headers panel)

  const logRef = useRef(null)

  // ---- load conversation list --------------------------------------------
  const loadConversations = useCallback(async () => {
    const { data: convos, error } = await supabase
      .from('conversations')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) return
    setConversations(convos || [])

    // Fetch peer profiles (RLS lets us read profiles of conversation peers).
    const peerIds = [...new Set((convos || []).map((c) =>
      c.user_low === me ? c.user_high : c.user_low))]
    if (peerIds.length) {
      const { data: profs } = await supabase
        .from('profiles').select('id,email,display_name').in('id', peerIds)
      const map = {}
      for (const p of profs || []) map[p.id] = p
      setPeers(map)
    }
    if (!activeId && convos?.length) setActiveId(convos[0].id)
  }, [me, activeId])

  useEffect(() => { if (me) loadConversations() }, [me, loadConversations])

  // ---- load an active conversation's messages/reactions/receipts ----------
  const loadThread = useCallback(async (conversationId) => {
    if (!conversationId) return
    const { data: msgs } = await supabase
      .from('messages').select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
    setMessages(msgs || [])

    const ids = (msgs || []).map((m) => m.id)
    if (ids.length) {
      const { data: rx } = await supabase
        .from('reactions').select('*').in('message_id', ids)
      const map = {}
      for (const r of rx || []) (map[r.message_id] ||= []).push(r)
      setReactions(map)
    } else {
      setReactions({})
    }

    const { data: rc } = await supabase
      .from('read_receipts').select('*').eq('conversation_id', conversationId)
    setReceipts(rc || [])

    // Mark as read (the GET) — upsert my last_read_at.
    await supabase.from('read_receipts').upsert(
      { conversation_id: conversationId, user_id: me, last_read_at: new Date().toISOString() },
      { onConflict: 'conversation_id,user_id' }
    )
  }, [me])

  useEffect(() => { loadThread(activeId) }, [activeId, loadThread])

  // ---- Realtime: live POST/PATCH/DELETE + reactions + receipts ------------
  useEffect(() => {
    if (!activeId) return
    setPresence('101 Switching Protocols')
    const chan = supabase
      .channel(`blow:${activeId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${activeId}` },
        () => loadThread(activeId))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'reactions' },
        () => loadThread(activeId))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'read_receipts', filter: `conversation_id=eq.${activeId}` },
        () => loadThread(activeId))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setPresence('101 Switching Protocols · connected')
        if (status === 'CLOSED' || status === 'CHANNEL_ERROR') setPresence('connection closed')
      })
    return () => { supabase.removeChannel(chan) }
  }, [activeId, loadThread])

  // ---- autoscroll to newest ----------------------------------------------
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [messages])

  // ---- start a conversation by email --------------------------------------
  const startByEmail = async (e) => {
    e.preventDefault()
    setLookupState(null)
    const email = newEmail.trim()
    if (!email) return
    if (email.toLowerCase() === (myEmail || '').toLowerCase()) {
      setLookupState({ type: 'error', msg: '400 Bad Request · that is your own address' })
      return
    }
    const { data: found, error } = await supabase.rpc('find_user_by_email', { p_email: email })
    if (error) { setLookupState({ type: 'error', msg: `500 · ${error.message}` }); return }
    const user = Array.isArray(found) ? found[0] : found
    if (!user) { setLookupState({ type: 'error', msg: '404 Not Found · no user with that email' }); return }

    const { data: cid, error: convErr } = await supabase.rpc('start_conversation', { p_other: user.id })
    if (convErr) { setLookupState({ type: 'error', msg: `403 · ${convErr.message}` }); return }
    setLookupState({ type: 'ok', msg: `201 Created · /chat/@${user.display_name || user.email}` })
    setNewEmail('')
    await loadConversations()
    setActiveId(cid)
  }

  // ---- send / edit (POST / PATCH) -----------------------------------------
  const sendRequest = async (e) => {
    e.preventDefault()
    if (!draft.trim() || !activeId) return
    setSending(true)
    try {
      if (editingId) {
        await supabase.from('messages')
          .update({ body: draft.trim(), method: 'PATCH', edited_at: new Date().toISOString() })
          .eq('id', editingId)
        setEditingId(null)
      } else {
        await supabase.from('messages').insert({
          conversation_id: activeId, sender_id: me, method: 'POST', body: draft.trim(),
        })
      }
      setDraft('')
      setDraftMethod('POST')
      await loadThread(activeId)
    } finally {
      setSending(false)
    }
  }

  // ---- soft-delete (DELETE tombstone) -------------------------------------
  const deleteMessage = async (m) => {
    await supabase.from('messages')
      .update({ method: 'DELETE', deleted_at: new Date().toISOString() })
      .eq('id', m.id)
    await loadThread(activeId)
  }

  const beginEdit = (m) => {
    setEditingId(m.id); setDraft(m.body); setDraftMethod('PATCH')
  }

  // ---- toggle a status-code reaction --------------------------------------
  const toggleReaction = async (messageId, code) => {
    const mine = (reactions[messageId] || []).find((r) => r.user_id === me && r.code === code)
    if (mine) {
      await supabase.from('reactions').delete()
        .eq('message_id', messageId).eq('user_id', me).eq('code', code)
    } else {
      await supabase.from('reactions').insert({ message_id: messageId, user_id: me, code })
    }
    await loadThread(activeId)
  }

  const activeConvo = conversations.find((c) => c.id === activeId)
  const activePeerId = activeConvo
    ? (activeConvo.user_low === me ? activeConvo.user_high : activeConvo.user_low)
    : null
  const activePeer = activePeerId ? peers[activePeerId] : null

  // Peer's last_read_at, for "Read" delivery status.
  const peerReadAt = receipts.find((r) => r.user_id === activePeerId)?.last_read_at

  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'grid',
      gridTemplateColumns: 'minmax(220px, 300px) minmax(0, 1fr)',
      gap: 'var(--gap)', fontFamily: MONO,
    }}>
      {/* ---- LEFT: connections list + new request ---- */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, gap: 12 }}>
        <div className="panel-title">/connections</div>

        <form onSubmit={startByEmail} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
            placeholder="user@host — open a socket"
            style={{ fontFamily: MONO, fontSize: '0.85rem' }}
          />
          <button type="submit" style={{
            background: METHOD_COLORS.POST, color: '#03110b', fontWeight: 700,
            fontFamily: MONO, fontSize: '0.8rem', minHeight: 38,
          }}>CONNECT</button>
          {lookupState && (
            <div style={{
              fontSize: '0.72rem',
              color: lookupState.type === 'error' ? METHOD_COLORS.DELETE : METHOD_COLORS.POST,
            }}>{lookupState.msg}</div>
          )}
        </form>

        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }}>
          {conversations.length === 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>
              204 No Content — no open connections yet.
            </div>
          )}
          {conversations.map((c) => {
            const pid = c.user_low === me ? c.user_high : c.user_low
            const p = peers[pid]
            const isActive = c.id === activeId
            return (
              <button key={c.id} onClick={() => setActiveId(c.id)} style={{
                textAlign: 'left', background: isActive ? 'var(--red)' : 'transparent',
                border: '1px solid var(--border)', color: isActive ? '#fff' : 'var(--text)',
                padding: '0.5em 0.6em', minHeight: 0, fontFamily: MONO, fontSize: '0.8rem',
                display: 'flex', flexDirection: 'column', gap: 2,
              }}>
                <span style={{ fontWeight: 600 }}>@{p?.display_name || p?.email || '...'}</span>
                <span style={{ fontSize: '0.68rem', opacity: 0.7 }}>
                  {c.status === 'pending' ? '102 Processing' : '200 OK'} · {p?.email}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ---- RIGHT: the request/response log ---- */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, padding: 0 }}>
        {/* status/header bar */}
        <div style={{
          padding: '10px 14px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <span style={{ color: METHOD_COLORS.GET, fontSize: '0.8rem', fontWeight: 700 }}>
            {activePeer ? `HTTP/1.1 · @${activePeer.display_name || activePeer.email}` : 'BLOW'}
          </span>
          <span style={{
            marginLeft: 'auto', fontSize: '0.68rem', color: METHOD_COLORS.GET,
            border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px',
          }}>{presence}</span>
        </div>

        {/* message log */}
        <div ref={logRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!activeId && (
            <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', margin: 'auto' }}>
              GET /chat → select or open a connection to begin.
            </div>
          )}
          {messages.map((m) => {
            const mine = m.sender_id === me
            const deleted = !!m.deleted_at
            const color = METHOD_COLORS[m.method] || METHOD_COLORS.POST
            const rx = reactions[m.id] || []
            // group reaction counts by code
            const counts = rx.reduce((a, r) => { a[r.code] = (a[r.code] || 0) + 1; return a }, {})
            const read = mine && peerReadAt && new Date(peerReadAt) >= new Date(m.created_at)
            return (
              <div key={m.id} style={{
                alignSelf: mine ? 'flex-end' : 'flex-start',
                maxWidth: '78%', display: 'flex', flexDirection: 'column', gap: 3,
              }}>
                {/* request line */}
                <div style={{
                  border: `1px solid ${color}`, borderLeft: `4px solid ${color}`,
                  borderRadius: 8, background: 'var(--bg)', overflow: 'hidden',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
                    <span style={{
                      background: color, color: '#03110b', fontWeight: 800, fontSize: '0.66rem',
                      padding: '1px 6px', borderRadius: 4, letterSpacing: '0.04em',
                    }}>{m.method}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                      /chat/{mine ? 'me' : '@' + (activePeer?.display_name || 'peer')}
                    </span>
                    {m.edited_at && !deleted && (
                      <span style={{ fontSize: '0.62rem', color: METHOD_COLORS.PATCH }}>· edited</span>
                    )}
                    <button
                      onClick={() => setExpanded((s) => ({ ...s, [m.id]: !s[m.id] }))}
                      style={{ marginLeft: 'auto', minHeight: 0, padding: '0 6px', background: 'transparent', color: 'var(--text-dim)', fontSize: '0.7rem' }}
                      title="Toggle headers"
                    >{expanded[m.id] ? '▾ headers' : '▸ headers'}</button>
                  </div>

                  {/* body */}
                  <div style={{
                    padding: '8px 12px', fontSize: '0.86rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    color: deleted ? 'var(--text-dim)' : 'var(--text)',
                    textDecoration: deleted ? 'line-through' : 'none',
                  }}>
                    {deleted ? '410 Gone — message deleted' : m.body}
                  </div>

                  {/* headers panel (collapsed by default, Postman-style) */}
                  {expanded[m.id] && (
                    <div style={{
                      borderTop: '1px solid var(--border)', padding: '8px 12px',
                      fontSize: '0.68rem', color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', gap: 2,
                    }}>
                      <div><span style={{ color: METHOD_COLORS.GET }}>Authorization:</span> {mine ? myEmail : activePeer?.email}</div>
                      <div><span style={{ color: METHOD_COLORS.GET }}>Content-Type:</span> text/plain; charset=utf-8</div>
                      <div><span style={{ color: METHOD_COLORS.GET }}>Date:</span> {new Date(m.created_at).toUTCString()}</div>
                      <div><span style={{ color: METHOD_COLORS.GET }}>X-Message-Id:</span> {m.id}</div>
                    </div>
                  )}
                </div>

                {/* reaction chips (existing) */}
                {Object.keys(counts).length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {Object.entries(counts).map(([code, n]) => {
                      const meta = STATUS_CODES.find((s) => s.code === Number(code))
                      const mineReacted = rx.some((r) => r.user_id === me && r.code === Number(code))
                      return (
                        <button key={code} onClick={() => toggleReaction(m.id, Number(code))} style={{
                          minHeight: 0, padding: '1px 6px', fontFamily: MONO, fontSize: '0.66rem',
                          background: mineReacted ? (meta?.color || 'var(--surface)') : 'var(--surface)',
                          color: mineReacted ? '#03110b' : (meta?.color || 'var(--text)'),
                          border: `1px solid ${meta?.color || 'var(--border)'}`, fontWeight: 700,
                        }}>{code} · {n}</button>
                      )
                    })}
                  </div>
                )}

                {/* action row: react / edit / delete + delivery status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: '0.64rem', color: 'var(--text-dim)' }}>
                  <details style={{ position: 'relative' }}>
                    <summary style={{ listStyle: 'none', cursor: 'pointer', color: METHOD_COLORS.GET }}>+ status</summary>
                    <div style={{
                      position: 'absolute', zIndex: 20, marginTop: 4, background: 'var(--surface)',
                      border: '1px solid var(--border)', borderRadius: 8, padding: 6, display: 'flex',
                      flexDirection: 'column', gap: 3, minWidth: 170,
                    }}>
                      {STATUS_CODES.map((s) => (
                        <button key={s.code} onClick={() => toggleReaction(m.id, s.code)} style={{
                          textAlign: 'left', minHeight: 0, padding: '3px 6px', fontFamily: MONO,
                          fontSize: '0.68rem', background: 'transparent', color: s.color, fontWeight: 700,
                        }}>{s.code} <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>{s.label}</span></button>
                      ))}
                    </div>
                  </details>
                  {mine && !deleted && (
                    <>
                      <button onClick={() => beginEdit(m)} style={{ minHeight: 0, padding: '0 4px', background: 'transparent', color: METHOD_COLORS.PATCH, fontSize: '0.64rem' }}>PATCH</button>
                      <button onClick={() => deleteMessage(m)} style={{ minHeight: 0, padding: '0 4px', background: 'transparent', color: METHOD_COLORS.DELETE, fontSize: '0.64rem' }}>DELETE</button>
                    </>
                  )}
                  {mine && !deleted && (
                    <span style={{ marginLeft: 'auto', color: read ? METHOD_COLORS.POST : 'var(--text-dim)' }}>
                      {read ? `200 OK · read` : `200 OK · ${latencyFor(m.id)}ms`}
                    </span>
                  )}
                  {!mine && (
                    <span style={{ marginLeft: 'auto' }}>{fmtTime(m.created_at)}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* composer as a request bar */}
        <form onSubmit={sendRequest} style={{
          borderTop: '1px solid var(--border)', padding: 10, display: 'flex', gap: 8, alignItems: 'stretch',
        }}>
          <select value={draftMethod} onChange={(e) => setDraftMethod(e.target.value)} disabled={!!editingId} style={{
            fontFamily: MONO, fontWeight: 700, minHeight: 42, maxWidth: 110,
            color: METHOD_COLORS[draftMethod], fontSize: '0.8rem',
          }}>
            <option value="POST">POST</option>
            <option value="PATCH">PATCH</option>
          </select>
          <input
            value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder={activeId ? `/chat/@${activePeer?.display_name || 'peer'} — request body` : 'open a connection first'}
            disabled={!activeId}
            style={{ flex: 1, fontFamily: MONO, fontSize: '0.85rem' }}
          />
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setDraft(''); setDraftMethod('POST') }} style={{
              minHeight: 42, background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-dim)', fontFamily: MONO, fontSize: '0.75rem',
            }}>cancel</button>
          )}
          <button type="submit" disabled={!activeId || sending || !draft.trim()} style={{
            minHeight: 42, background: METHOD_COLORS[editingId ? 'PATCH' : 'POST'], color: '#03110b',
            fontWeight: 800, fontFamily: MONO, fontSize: '0.78rem', whiteSpace: 'nowrap',
          }}>
            {sending ? '202 Accepted…' : editingId ? 'Send PATCH' : 'Send request'}
          </button>
        </form>
      </div>
    </div>
  )
}
