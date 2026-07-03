import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { usePref } from '../lib/usePref'
import { Heat, Pill, Spinner, Empty, MergeChips } from '../components/ui'
import { timeAgo, dateShort } from '../lib/format'
import { Link } from 'react-router-dom'

const STATUSES = ['all', 'new', 'enriched', 'in_sequence', 'replied', 'won', 'lost', 'unsubscribed']
const SOURCES = ['all', 'places', 'web', 'csv', 'manual']

export default function Leads() {
  const { effectiveOrgId, supportView } = useAuth()
  const [leads, setLeads] = useState(null)
  const [filter, setFilter] = useState('all')
  const [source, setSource] = usePref('leads.source', 'all')
  const [sort, setSort] = usePref('leads.sort', 'newest')       // newest | company | status
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)

  const load = useCallback(async () => {
    if (!effectiveOrgId) return
    let query = supabase.from('leads').select('*').eq('org_id', effectiveOrgId)
      .order('created_at', { ascending: false }).limit(500)
    if (filter !== 'all') query = query.eq('status', filter)
    const { data } = await query
    setLeads(data || [])
  }, [effectiveOrgId, filter])

  useEffect(() => { load() }, [load])

  if (!leads) return <Spinner />
  const shown = leads
    .filter((l) => source === 'all' || l.source === source)
    .filter((l) => !q || `${l.name} ${l.company} ${l.email} ${l.city}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'company') return (a.company || a.name || '').localeCompare(b.company || b.name || '')
      if (sort === 'status') return STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status)
      return 0 // newest — query already returns created_at desc
    })

  return (
    <div>
      <div className="row-between">
        <h1>Leads</h1>
        <input placeholder="Search…" style={{ maxWidth: 220 }} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 6, margin: '12px 0 6px', flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <button key={s} className={`btn small ${filter === s ? 'primary' : 'ghost'}`} onClick={() => setFilter(s)}>
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>
      <div className="row-between" style={{ margin: '0 0 12px' }}>
        <div className="seg small" role="tablist" aria-label="Source">
          {SOURCES.map((s) => (
            <button key={s} role="tab" aria-selected={source === s} className={source === s ? 'on' : ''} onClick={() => setSource(s)}>{s}</button>
          ))}
        </div>
        <label className="faint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          Sort
          <select style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">Newest first</option>
            <option value="company">Company A–Z</option>
            <option value="status">Pipeline stage</option>
          </select>
        </label>
      </div>
      {shown.length === 0 ? (
        <Empty title="No leads here yet" body="Discovery, the website prospector, and CSV import all land leads on this screen."
          action={<Link to="/discover" className="btn primary" style={{ display: 'inline-block' }}>Find leads</Link>} />
      ) : (
        <div className="section" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="plain">
            <thead><tr><th style={{ width: 56 }}>Heat</th><th>Lead</th><th>Contact</th><th>Status</th><th>Source</th><th>Added</th></tr></thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.id} className="clickable" onClick={() => setSel(l)}>
                  <td><Heat status={l.status} /></td>
                  <td><strong>{l.company || l.name || '—'}</strong>{l.name && l.company ? <div className="faint">{l.name}</div> : null}</td>
                  <td className="muted">{l.email || l.phone || (l.website || '').replace(/^https?:\/\//, '').slice(0, 26) || '—'}</td>
                  <td><Pill v={l.status} /></td>
                  <td className="faint">{l.source}</td>
                  <td className="faint">{dateShort(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sel && <LeadDrawer lead={sel} onClose={() => { setSel(null); load() }} readOnly={supportView} />}
    </div>
  )
}

function LeadDrawer({ lead, onClose, readOnly }) {
  const { effectiveOrgId, session } = useAuth()
  const [enrichment, setEnrichment] = useState(null)
  const [messages, setMessages] = useState([])
  const [consents, setConsents] = useState([])
  const [sequences, setSequences] = useState([])
  const [connections, setConnections] = useState([])
  const [enrollSeq, setEnrollSeq] = useState('')
  const [enrollConn, setEnrollConn] = useState('')
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('lead_enrichment').select('*').eq('lead_id', lead.id).maybeSingle().then(({ data }) => setEnrichment(data))
    supabase.from('messages').select('*').eq('lead_id', lead.id).order('occurred_at').then(({ data }) => setMessages(data || []))
    supabase.from('consent_log').select('*').eq('lead_id', lead.id).then(({ data }) => setConsents(data || []))
    supabase.from('sequences').select('*').eq('org_id', effectiveOrgId).eq('status', 'active').then(({ data }) => {
      setSequences(data || []); if (data?.[0]) setEnrollSeq(data[0].id)
    })
    supabase.from('comms_connections').select('*').eq('org_id', effectiveOrgId).eq('status', 'active')
      .in('kind', ['gmail', 'outlook', 'smtp_imap']).then(({ data }) => {
        setConnections(data || []); if (data?.[0]) setEnrollConn(data[0].id)
      })
  }, [lead.id, effectiveOrgId])

  const enroll = async () => {
    setBusy(true); setNote(null)
    try {
      const r = await api('enroll-leads', { method: 'POST', body: { sequence_id: enrollSeq, lead_ids: [lead.id], connection_id: enrollConn } })
      setNote({ ok: true, text: r.enrolled ? 'Enrolled — first step is scheduled.' : 'Already in that sequence.' })
    } catch (e) { setNote({ ok: false, text: e.message }) }
    setBusy(false)
  }

  const setStatus = async (status) => {
    await supabase.from('leads').update({ status }).eq('id', lead.id)
    onClose()
  }

  const recordSmsConsent = async () => {
    const evidence = prompt('How did this lead consent to texts? (e.g. "checked SMS box on intake form 6/28")')
    if (!evidence) return
    await supabase.from('consent_log').insert({
      org_id: effectiveOrgId, lead_id: lead.id, channel: 'sms',
      method: 'manual_confirmed', captured_by: session.user.id, evidence: { note: evidence },
    })
    const { data } = await supabase.from('consent_log').select('*').eq('lead_id', lead.id)
    setConsents(data || [])
  }

  const sig = enrichment?.signals || {}
  const tech = Object.entries(enrichment?.tech || {}).filter(([, v]) => v).map(([k]) => k)

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <div className="drawer fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2>{lead.company || lead.name || 'Lead'}</h2>
          <button className="btn small ghost" onClick={onClose}>Close</button>
        </div>
        <p className="muted" style={{ margin: '4px 0 12px' }}>
          <Heat status={lead.status} /> <Pill v={lead.status} /> · {lead.source}
          {lead.city ? ` · ${lead.city}` : ''}{lead.rating ? ` · ${lead.rating}★ (${lead.review_count})` : ''}
        </p>

        <div className="section" style={{ margin: '10px 0' }}>
          <h3>Contact</h3>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {lead.name && <>Person: {lead.name}{lead.title ? ` — ${lead.title}` : ''}<br /></>}
            {lead.email && <>Email: <span className="mono">{lead.email}</span><br /></>}
            {lead.phone && <>Phone: <span className="mono">{lead.phone}</span><br /></>}
            {lead.website && <>Site: <a href={lead.website} target="_blank" rel="noreferrer">{lead.website.replace(/^https?:\/\//, '')}</a><br /></>}
            {lead.linkedin_url && <>LinkedIn: <a href={lead.linkedin_url} target="_blank" rel="noreferrer">profile ↗</a></>}
          </p>
        </div>

        {enrichment && (
          <div className="section" style={{ margin: '10px 0' }}>
            <h3>What we noticed</h3>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              {sig.headline && <>Headline: “{sig.headline}”<br /></>}
              {enrichment.site_description && <>{enrichment.site_description.slice(0, 160)}<br /></>}
              {tech.length > 0 && <>Stack: <span className="mono">{tech.join(', ')}</span><br /></>}
              {sig.has_booking === false && <>No online booking found — often a strong opener.<br /></>}
              {sig.copyright_year && sig.copyright_year < new Date().getFullYear() - 1 && <>Footer says © {sig.copyright_year} — site may be unattended.</>}
            </p>
          </div>
        )}

        {!readOnly && (
          <div className="section" style={{ margin: '10px 0' }}>
            <h3>Put in a sequence</h3>
            {sequences.length === 0 ? (
              <p className="muted">No active sequences yet — build one on the Sequences page.</p>
            ) : (
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                <select value={enrollSeq} onChange={(e) => setEnrollSeq(e.target.value)}>
                  {sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select value={enrollConn} onChange={(e) => setEnrollConn(e.target.value)}>
                  {connections.length === 0 && <option value="">No mailbox connected — see Settings</option>}
                  {connections.map((c) => <option key={c.id} value={c.id}>Send as {c.address}</option>)}
                </select>
                {note && <div className={`banner ${note.ok ? 'ok' : 'err'}`} style={{ margin: 0 }}>{note.text}</div>}
                <button className="btn primary" disabled={busy || !enrollSeq || !enrollConn} onClick={enroll}>Enroll</button>
              </div>
            )}
          </div>
        )}

        <div className="section" style={{ margin: '10px 0' }}>
          <div className="row-between">
            <h3>SMS consent</h3>
            {!readOnly && <button className="btn small ghost" onClick={recordSmsConsent}>Record consent</button>}
          </div>
          {consents.length === 0 ? (
            <p className="muted">None on file. Texts to this lead are blocked until consent is recorded — that's the TCPA line and we hold it for you.</p>
          ) : consents.map((c) => (
            <p key={c.id} className="muted" style={{ margin: '6px 0 0' }}>
              <Pill v="sent" /> {c.channel} · {c.method.replace(/_/g, ' ')} · {dateShort(c.captured_at)}
              {c.evidence?.note ? ` — “${c.evidence.note}”` : ''}
            </p>
          ))}
        </div>

        <div className="section" style={{ margin: '10px 0' }}>
          <h3>Timeline</h3>
          {messages.length === 0 ? <p className="muted">No touches yet.</p> : messages.map((m) => (
            <div key={m.id} className={`bubble ${m.direction}`}>
              <div className="meta">
                <span>{m.direction === 'inbound' ? '← reply' : '→ ' + m.channel}</span>
                <Pill v={m.status} /><span>{timeAgo(m.occurred_at)}</span>
              </div>
              {m.subject && <strong style={{ fontSize: 13.5 }}>{m.subject}</strong>}
              <pre>{m.body_text || m.snippet}</pre>
            </div>
          ))}
        </div>

        {!readOnly && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn small" style={{ background: 'var(--good)' }} onClick={() => setStatus('won')}>Mark won</button>
            <button className="btn small ghost" onClick={() => setStatus('lost')}>Mark lost</button>
          </div>
        )}
      </div>
    </div>
  )
}
