import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Spinner, Empty, Pill, MergeChips } from '../components/ui'

const TIER = { starter: 0, growth: 1, pro: 2 }
const CHANNEL_TIER = { email: 'starter', linkedin: 'growth', sms: 'pro' }

export default function Sequences() {
  const { effectiveOrgId, org, supportView } = useAuth()
  const [list, setList] = useState(null)
  const [editing, setEditing] = useState(null)   // sequence object or 'new'

  const load = useCallback(async () => {
    if (!effectiveOrgId) return
    const [{ data: seqs }, { data: enrolls }] = await Promise.all([
      supabase.from('sequences').select('*').eq('org_id', effectiveOrgId).neq('status', 'archived').order('created_at', { ascending: false }),
      supabase.from('enrollments').select('sequence_id, status').eq('org_id', effectiveOrgId),
    ])
    const stats = {}
    for (const e of enrolls || []) {
      stats[e.sequence_id] = stats[e.sequence_id] || { active: 0, replied: 0, completed: 0 }
      if (e.status === 'active' || e.status === 'task_pending') stats[e.sequence_id].active++
      if (e.status === 'replied') stats[e.sequence_id].replied++
      if (e.status === 'completed') stats[e.sequence_id].completed++
    }
    setList((seqs || []).map((s) => ({ ...s, stats: stats[s.id] || { active: 0, replied: 0, completed: 0 } })))
  }, [effectiveOrgId])

  useEffect(() => { load() }, [load])

  if (!list) return <Spinner />
  if (editing) return <Editor sequence={editing === 'new' ? null : editing} org={org}
    onDone={() => { setEditing(null); load() }} />

  return (
    <div>
      <div className="row-between">
        <h1>Sequences</h1>
        {!supportView && <button className="btn primary" onClick={() => setEditing('new')}>New sequence</button>}
      </div>
      <p className="muted">Multi-step, multi-channel. Every sequence stops the moment a lead replies — nobody gets a follow-up after they've answered.</p>
      {list.length === 0 ? (
        <Empty title="No sequences yet" body="A good starter: email on day 0, LinkedIn note on day 3, email follow-up on day 7." />
      ) : (
        <div className="section" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="tablewrap"><table className="plain">
            <thead><tr><th>Sequence</th><th>Status</th><th>Active</th><th>Replied</th><th>Finished</th><th /></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong>{s.stop_on_reply && <div className="faint">stops on reply</div>}</td>
                  <td><Pill v={s.status} /></td>
                  <td className="mono">{s.stats.active}</td>
                  <td className="mono" style={{ color: 'var(--reply)' }}>{s.stats.replied}</td>
                  <td className="mono">{s.stats.completed}</td>
                  <td style={{ textAlign: 'right' }}>
                    {!supportView && <>
                      <button className="btn small ghost" onClick={() => setEditing(s)}>Edit</button>{' '}
                      <button className="btn small ghost" onClick={async () => {
                        await supabase.from('sequences').update({ status: s.status === 'active' ? 'paused' : 'active' }).eq('id', s.id); load()
                      }}>{s.status === 'active' ? 'Pause' : 'Resume'}</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  )
}

function Editor({ sequence, org, onDone }) {
  const { effectiveOrgId, session } = useAuth()
  const [name, setName] = useState(sequence?.name || '')
  const [stopOnReply, setStopOnReply] = useState(sequence?.stop_on_reply ?? true)
  const [steps, setSteps] = useState(null)
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!sequence) { setSteps([blankStep(1)]); return }
    supabase.from('sequence_steps').select('*').eq('sequence_id', sequence.id).order('step_order')
      .then(({ data }) => setSteps(data?.length ? data : [blankStep(1)]))
  }, [sequence])

  const tierOk = (ch) => (TIER[org?.plan_tier] ?? 0) >= TIER[CHANNEL_TIER[ch]]

  const save = async () => {
    setBusy(true); setNote(null)
    try {
      let seqId = sequence?.id
      if (!seqId) {
        const { data, error } = await supabase.from('sequences').insert({
          org_id: effectiveOrgId, name, stop_on_reply: stopOnReply, created_by: session.user.id,
        }).select('id').single()
        if (error) throw error
        seqId = data.id
      } else {
        await supabase.from('sequences').update({ name, stop_on_reply: stopOnReply }).eq('id', seqId)
        await supabase.from('sequence_steps').delete().eq('sequence_id', seqId)
      }
      const rows = steps.map((s, i) => ({
        sequence_id: seqId, org_id: effectiveOrgId, step_order: i + 1,
        channel: s.channel, delay_days: Number(s.delay_days) || 0,
        subject: s.channel === 'email' ? s.subject : null, body: s.body, use_ai: !!s.use_ai,
      }))
      const { error } = await supabase.from('sequence_steps').insert(rows)
      if (error) throw error
      onDone()
    } catch (e) { setNote(e.message) }
    setBusy(false)
  }

  if (!steps) return <Spinner />
  return (
    <div>
      <div className="row-between">
        <h1>{sequence ? 'Edit sequence' : 'New sequence'}</h1>
        <button className="btn ghost" onClick={onDone}>Back</button>
      </div>
      <div className="section">
        <div style={{ display: 'grid', gap: 10 }}>
          <label>Name<input placeholder="Med spa opener" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={stopOnReply} onChange={(e) => setStopOnReply(e.target.checked)} />
            Stop the sequence the moment they reply (recommended — always on for now)
          </label>
        </div>
      </div>

      {steps.map((s, i) => (
        <div key={i} className="section">
          <div className="row-between">
            <h3>Step {i + 1}{i === 0 ? ' — first touch' : ''}</h3>
            {steps.length > 1 && <button className="btn small ghost" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>Remove</button>}
          </div>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr', marginTop: 8 }}>
            <label>Channel
              <select value={s.channel} onChange={(e) => patch(setSteps, i, { channel: e.target.value })}>
                <option value="email">Email</option>
                <option value="linkedin" disabled={!tierOk('linkedin')}>LinkedIn note {tierOk('linkedin') ? '(you send it)' : '— Growth plan'}</option>
                <option value="sms" disabled={!tierOk('sms')}>Text {tierOk('sms') ? '(consented leads only)' : '— Pro plan'}</option>
              </select>
            </label>
            <label>{i === 0 ? 'Send after enrolling (days)' : 'Wait after previous step (days)'}
              <input type="number" min="0" value={s.delay_days} onChange={(e) => patch(setSteps, i, { delay_days: e.target.value })} />
            </label>
          </div>
          {s.channel === 'email' && (
            <label style={{ display: 'block', marginTop: 10 }}>Subject
              <input placeholder="Quick question about {{company}}" value={s.subject || ''} onChange={(e) => patch(setSteps, i, { subject: e.target.value })} />
            </label>
          )}
          <label style={{ display: 'block', marginTop: 10 }}>Message
            <MergeChips onPick={(f) => patch(setSteps, i, { body: (s.body || '') + f })} />
            <textarea value={s.body} onChange={(e) => patch(setSteps, i, { body: e.target.value })}
              placeholder={s.channel === 'linkedin' ? 'Short and human — this lands as a connection note you send yourself.' : 'Hi {{first_name}} — noticed {{signal}}…'} />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
            <input type="checkbox" style={{ width: 'auto', marginTop: 3 }} checked={!!s.use_ai} onChange={(e) => patch(setSteps, i, { use_ai: e.target.checked })} />
            <span className="muted">Personalize with AI at send time — uses each lead's enrichment signals, falls back to this template if drafting fails.</span>
          </label>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn ghost" onClick={() => setSteps([...steps, blankStep(steps.length + 1)])}>Add step</button>
        <button className="btn primary" disabled={busy || !name || steps.some((s) => !s.body)} onClick={save}>Save sequence</button>
      </div>
      {note && <div className="banner err" style={{ marginTop: 10 }}>{note}</div>}
      <p className="faint" style={{ marginTop: 12 }}>
        Every email automatically carries your business name, mailing address, and a working unsubscribe link. Sends respect each mailbox's daily cap and warm-up ramp.
      </p>
    </div>
  )
}

const blankStep = (order) => ({ step_order: order, channel: 'email', delay_days: order === 1 ? 0 : 3, subject: '', body: '', use_ai: false })
const patch = (setSteps, i, p) => setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...p } : s)))
