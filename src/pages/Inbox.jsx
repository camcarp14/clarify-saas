import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { usePref } from '../lib/usePref'
import { Spinner, Empty, Pill } from '../components/ui'
import { timeAgo } from '../lib/format'
import { Link } from 'react-router-dom'

export default function Inbox() {
  const { effectiveOrgId, supportView } = useAuth()
  const [threads, setThreads] = useState(null)
  const [sel, setSel] = useState(null)
  const [filter, setFilter] = usePref('inbox.filter', 'all')   // all | unread

  const load = useCallback(async () => {
    if (!effectiveOrgId) return
    const { data: msgs } = await supabase.from('messages')
      .select('*, leads(id, name, company, email, phone, status)')
      .eq('org_id', effectiveOrgId).order('occurred_at', { ascending: false }).limit(600)
    const byLead = new Map()
    for (const m of msgs || []) {
      if (!m.leads) continue
      if (!byLead.has(m.lead_id)) byLead.set(m.lead_id, { lead: m.leads, last: m, unread: 0 })
      if (m.direction === 'inbound' && !m.is_read) byLead.get(m.lead_id).unread++
    }
    setThreads([...byLead.values()])
  }, [effectiveOrgId])

  useEffect(() => { load() }, [load])

  if (!threads) return <Spinner />
  if (threads.length === 0) return (
    <div>
      <h1>Inbox</h1>
      <Empty title="No conversations yet"
        body="Once sequences start sending, every thread — and every reply — lives here. No tab-switching back to Gmail."
        action={<Link to="/sequences" className="btn primary" style={{ display: 'inline-block' }}>Build a sequence</Link>} />
    </div>
  )

  const shown = filter === 'unread' ? threads.filter((t) => t.unread > 0) : threads

  return (
    <div>
      <div className="row-between">
        <h1>Inbox</h1>
        <div className="seg" role="tablist" aria-label="Filter">
          {[['all', 'All'], ['unread', 'Unread']].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
      </div>
      <p className="muted">Replies land here from every connected mailbox. Answer without leaving.</p>
      <div className="inbox" style={{ marginTop: 14 }}>
        <div className="threadlist">
          {shown.length === 0 && <div className="thread"><span className="muted">No {filter === 'unread' ? 'unread ' : ''}conversations.</span></div>}
          {shown.map((t) => (
            <div key={t.lead.id} className={`thread ${sel === t.lead.id ? 'sel' : ''} ${t.unread ? 'unread' : ''}`}
              onClick={() => setSel(t.lead.id)}>
              <div className="who">
                <span>{t.lead.company || t.lead.name || t.lead.email}</span>
                {t.unread > 0 && <span className="dot" />}
              </div>
              <div className="faint">{t.last.snippet?.slice(0, 52) || t.last.subject} · {timeAgo(t.last.occurred_at)}</div>
            </div>
          ))}
        </div>
        {sel ? <Thread leadId={sel} readOnly={supportView} onChange={load} />
          : <div className="section" style={{ margin: 0 }}><p className="muted">Pick a conversation.</p></div>}
      </div>
    </div>
  )
}

function Thread({ leadId, readOnly, onChange }) {
  const { effectiveOrgId, org } = useAuth()
  const [lead, setLead] = useState(null)
  const [messages, setMessages] = useState(null)
  const [hasSmsConsent, setHasSmsConsent] = useState(false)
  const [reply, setReply] = useState('')
  const [channel, setChannel] = useState('email')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  const load = useCallback(async () => {
    const [{ data: l }, { data: ms }, { data: consent }] = await Promise.all([
      supabase.from('leads').select('*').eq('id', leadId).single(),
      supabase.from('messages').select('*').eq('lead_id', leadId).order('occurred_at'),
      supabase.from('consent_log').select('id').eq('lead_id', leadId).eq('channel', 'sms').limit(1),
    ])
    setLead(l); setMessages(ms || []); setHasSmsConsent(!!consent?.length)
    const unreadIds = (ms || []).filter((m) => m.direction === 'inbound' && !m.is_read).map((m) => m.id)
    if (unreadIds.length) {
      await supabase.from('messages').update({ is_read: true }).in('id', unreadIds)
      onChange?.()
    }
  }, [leadId])

  useEffect(() => { setReply(''); setNote(null); setChannel('email'); load() }, [load])

  const send = async () => {
    setBusy(true); setNote(null)
    try {
      await api('send-reply', { method: 'POST', body: { lead_id: leadId, body: reply, channel } })
      setReply(''); await load()
    } catch (e) { setNote(e.message) }
    setBusy(false)
  }

  const draft = async () => {
    setBusy(true); setNote(null)
    try {
      const r = await api('ai-draft', { method: 'POST', body: { lead_id: leadId, channel, purpose: 'reply to their latest message and move toward a call' } })
      setReply(r.draft)
    } catch (e) { setNote(e.message) }
    setBusy(false)
  }

  if (!messages) return <Spinner />
  const canSms = org?.plan_tier === 'pro' && lead?.phone && hasSmsConsent

  return (
    <div className="section" style={{ margin: 0 }}>
      <div className="row-between">
        <h2>{lead?.company || lead?.name}</h2>
        <Pill v={lead?.status} />
      </div>
      <div style={{ maxHeight: '48vh', overflowY: 'auto', margin: '10px 0' }}>
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.direction}`}>
            <div className="meta">
              <span>{m.direction === 'inbound' ? '← them' : '→ you'} · {m.channel}</span>
              <span>{timeAgo(m.occurred_at)}</span>
              {m.status !== 'sent' && m.status !== 'received' && <Pill v={m.status} />}
            </div>
            {m.subject && <strong style={{ fontSize: 13.5 }}>{m.subject}</strong>}
            <pre>{m.body_text || m.snippet}</pre>
          </div>
        ))}
      </div>
      {!readOnly && (
        <div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button className={`btn small ${channel === 'email' ? 'primary' : 'ghost'}`} onClick={() => setChannel('email')}>Email</button>
            {canSms && <button className={`btn small ${channel === 'sms' ? 'primary' : 'ghost'}`} onClick={() => setChannel('sms')}>Text</button>}
          </div>
          <textarea placeholder={channel === 'sms' ? 'Text back… (consent is on file)' : 'Reply — it threads onto the same email conversation.'}
            value={reply} onChange={(e) => setReply(e.target.value)} />
          {note && <div className="banner err" style={{ marginTop: 8 }}>{note}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn primary" disabled={busy || !reply.trim()} onClick={send}>Send {channel === 'sms' ? 'text' : 'reply'}</button>
            <button className="btn ghost" disabled={busy} onClick={draft}>Draft with AI</button>
          </div>
        </div>
      )}
    </div>
  )
}
