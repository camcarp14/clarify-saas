import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { Spinner } from '../../components/ui';

// Model tuning — the room where Clarify's judgment lives.
// Weights reshape every audit score on the next run; analyst notes steer every
// AI brief. One save, whole product recalibrated. No deploy.
export default function AdminModel() {
  const [data, setData] = useState(null);
  const [weights, setWeights] = useState(null);
  const [notes, setNotes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(null);

  const load = async () => {
    try {
      const d = await api('model-settings');
      setData(d);
      setWeights(structuredClone(d.effective.weights));
      setNotes(structuredClone({ global: '', categories: {}, ...d.effective.notes }));
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  if (err) return <div className="banner err">{err}</div>;
  if (!weights) return <Spinner label="Loading model settings…" />;

  const setW = (path, val) => {
    setWeights((w) => {
      const next = structuredClone(w);
      let node = next;
      for (const k of path.slice(0, -1)) node = node[k];
      node[path[path.length - 1]] = val;
      return next;
    });
  };
  const numInput = (path, { step = 0.1, min = 0, max = 99999 } = {}) => {
    let node = weights;
    for (const k of path) node = node?.[k];
    return (
      <input type="number" step={step} min={min} max={max} value={node ?? ''}
        onChange={(e) => setW(path, e.target.value === '' ? 0 : Number(e.target.value))} />
    );
  };

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await api('model-settings', { method: 'POST', body: { weights, notes } });
      setSaved(true); setTimeout(() => setSaved(false), 2500);
      setData((d) => ({ ...d, global: { ...(d.global || {}), version: res.version, updated_at: new Date().toISOString() } }));
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const reset = async () => {
    if (!confirm('Reset every weight, threshold, and note to shipped defaults? Takes effect on the next audit run.')) return;
    setWeights(structuredClone(data.defaults.weights));
    setNotes(structuredClone(data.defaults.notes));
  };

  const catNote = (cat) => (
    <label key={cat} style={{ display: 'block' }}>
      <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{cat}</span>
      <textarea rows={2} value={notes.categories?.[cat] || ''} placeholder="e.g. Always frame this against booked jobs, not clicks."
        onChange={(e) => setNotes((n) => ({ ...n, categories: { ...n.categories, [cat]: e.target.value } }))} />
    </label>
  );

  return (
    <div>
      <div className="row-between">
        <h1>Model tuning</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn ghost" onClick={reset}>Reset to defaults</button>
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save & version'}</button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 4 }}>
        Weights reshape every audit score on its next run. Notes are injected into every AI strategist brief as standing guidance.
        {' '}Current: <span className="mono">v{data.global?.version || 1}</span>
        {data.global?.updated_at && <> · updated {timeAgo(data.global.updated_at)}</>}
      </p>

      <div className="section">
        <h2>Severity weights</h2>
        <p className="muted" style={{ margin: '4px 0 8px' }}>Score = 100 − Σ (severity weight × category multiplier) across findings. Shipped: 18 / 8 / 3.</p>
        <div className="wgrid" style={{ maxWidth: 620 }}>
          <label>critical {numInput(['severity', 'critical'], { step: 1, max: 40 })}</label>
          <label>warning {numInput(['severity', 'warning'], { step: 1, max: 40 })}</label>
          <label>opportunity {numInput(['severity', 'opportunity'], { step: 1, max: 40 })}</label>
        </div>
      </div>

      <div className="section" data-ch="paid">
        <h2 style={{ color: 'var(--paid)' }}>Paid — category multipliers</h2>
        <p className="muted" style={{ margin: '4px 0 8px' }}>1 = neutral. Above 1 punishes the score harder and tells the AI to prioritize; below 1 quiets it.</p>
        <div className="wgrid">
          {Object.keys(weights.categories.paid).map((cat) => (
            <label key={cat}>{cat.replace(/_/g, ' ')} {numInput(['categories', 'paid', cat], { step: 0.1, max: 3 })}</label>
          ))}
        </div>
      </div>

      <div className="section" data-ch="organic">
        <h2 style={{ color: 'var(--org)' }}>Organic — category multipliers</h2>
        <div className="wgrid" style={{ marginTop: 10 }}>
          {Object.keys(weights.categories.organic).map((cat) => (
            <label key={cat}>{cat.replace(/_/g, ' ')} {numInput(['categories', 'organic', cat], { step: 0.1, max: 3 })}</label>
          ))}
        </div>
      </div>

      <div className="section">
        <h2>Thresholds</h2>
        <p className="muted" style={{ margin: '4px 0 8px' }}>The lines the rules draw. Every one shows up verbatim in a receipt's formula.</p>
        <div className="wgrid">
          <label>smart bidding min conv/30d {numInput(['thresholds', 'smart_bidding_min_conv_30d'], { step: 1, max: 200 })}</label>
          <label>waste: min clicks {numInput(['thresholds', 'waste_min_clicks'], { step: 1, max: 50 })}</label>
          <label>waste share → critical {numInput(['thresholds', 'waste_share_critical'], { step: 0.01, max: 1 })}</label>
          <label>waste share → warning {numInput(['thresholds', 'waste_share_warning'], { step: 0.01, max: 1 })}</label>
          <label>broad-match share flag {numInput(['thresholds', 'broad_share_flag'], { step: 0.05, max: 1 })}</label>
          <label>thin content (words) {numInput(['thresholds', 'thin_content_words'], { step: 25, max: 2000 })}</label>
          <label>title max length {numInput(['thresholds', 'title_max_len'], { step: 1, max: 90 })}</label>
          <label>title min length {numInput(['thresholds', 'title_min_len'], { step: 1, max: 60 })}</label>
          <label>page weight (bytes) {numInput(['thresholds', 'page_weight_bytes'], { step: 100000, max: 20000000 })}</label>
          <label>striking distance: from pos {numInput(['thresholds', 'striking_distance_min_pos'], { step: 1, max: 20 })}</label>
          <label>striking distance: to pos {numInput(['thresholds', 'striking_distance_max_pos'], { step: 1, max: 50 })}</label>
          <label>overlap: organic top position {numInput(['thresholds', 'organic_top_position'], { step: 1, max: 10 })}</label>
          <label>overlap: reclaim factor {numInput(['thresholds', 'overlap_reclaim_factor'], { step: 0.05, max: 1 })}</label>
          <label>playbook: target position {numInput(['thresholds', 'target_position'], { step: 1, max: 10 })}</label>
          <label>playbook: default $/click {numInput(['thresholds', 'value_per_click_default'], { step: 0.5, max: 200 })}</label>
        </div>
      </div>

      <div className="section">
        <h2>Analyst notes</h2>
        <p className="muted" style={{ margin: '4px 0 10px' }}>
          Standing guidance for the AI strategist — your judgment, in its prompt, on every brief. It can prioritize and phrase around these; it can never invent numbers because of them.
        </p>
        <div className="wnote">
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>global</span>
          <textarea rows={4} value={notes.global || ''}
            placeholder={'e.g. Lead with dollars, not percentages. For local service clients, treat call conversions as the primary conversion. Never recommend broad match without a negative-list plan.'}
            onChange={(e) => setNotes((n) => ({ ...n, global: e.target.value }))} />
        </div>
        <h3 style={{ marginTop: 14 }}>Per-category notes</h3>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', marginTop: 8 }}>
          {[...Object.keys(weights.categories.paid), ...Object.keys(weights.categories.organic), 'paid_organic_overlap', 'content_gaps'].map(catNote)}
        </div>
      </div>
    </div>
  );
}
