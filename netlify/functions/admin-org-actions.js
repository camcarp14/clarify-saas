// POST { action, org_id, ...payload } — every admin mutation in the product goes
// through here: is_clarify_admin gate -> service-role write -> audit_log row.
// RLS write policies stay untouched; the client NEVER writes another org directly.
const { getCaller, admin, json, CREDITS_BY_TIER } = require('./_shared/util');

const TIERS = ['starter', 'growth', 'pro'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  if (!caller.profile.is_clarify_admin) return json(403, { error: 'Admins only' });

  const body = JSON.parse(event.body || '{}');
  const { action, org_id } = body;
  if (!action || !org_id) return json(400, { error: 'action and org_id required' });

  const db = admin();
  const { data: org } = await db.from('organizations').select('*').eq('id', org_id).single();
  if (!org) return json(404, { error: 'Org not found' });

  const log = (act, target, meta = {}) =>
    db.from('audit_log').insert({ actor_id: caller.user.id, org_id, action: act, target: target || org.name, meta });

  switch (action) {
    case 'plan_change': {
      const { tier } = body;
      if (!TIERS.includes(tier)) return json(400, { error: 'Invalid tier' });
      await db.from('organizations').update({ plan_tier: tier, monthly_credits: CREDITS_BY_TIER[tier] }).eq('id', org_id);
      await log('admin_plan_change', org.name, { from: org.plan_tier, to: tier });
      return json(200, { ok: true });
    }
    case 'credit_grant': {
      const credits = parseInt(body.credits, 10);
      if (!credits || credits < 1 || credits > 100000) return json(400, { error: 'credits must be 1–100000' });
      await db.from('organizations').update({ monthly_credits: (org.monthly_credits || 0) + credits }).eq('id', org_id);
      await log('admin_credit_grant', org.name, { credits, new_total: (org.monthly_credits || 0) + credits });
      return json(200, { ok: true });
    }
    case 'credit_reset': {
      await db.from('organizations').update({ credits_used: 0, period_started_at: new Date().toISOString() }).eq('id', org_id);
      await log('admin_credit_period_reset', org.name, { previous_used: org.credits_used });
      return json(200, { ok: true });
    }
    case 'trial_extend': {
      const days = parseInt(body.days, 10);
      if (!days || days < 1 || days > 90) return json(400, { error: 'days must be 1–90' });
      const base = Math.max(Date.now(), new Date(org.trial_ends_at || 0).getTime());
      const until = new Date(base + days * 86400000).toISOString();
      await db.from('organizations').update({ trial_ends_at: until, subscription_status: org.subscription_status === 'canceled' ? 'trialing' : org.subscription_status }).eq('id', org_id);
      await log('admin_trial_extend', org.name, { days, until });
      return json(200, { ok: true, until });
    }
    case 'notes_update': {
      await db.from('organizations').update({ internal_notes: String(body.notes || '').slice(0, 8000) }).eq('id', org_id);
      await log('admin_notes_update', org.name, {});
      return json(200, { ok: true });
    }
    case 'suspend': {
      await db.from('organizations').update({ suspended_at: new Date().toISOString() }).eq('id', org_id);
      await log('admin_org_suspended', org.name, {});
      return json(200, { ok: true });
    }
    case 'unsuspend': {
      await db.from('organizations').update({ suspended_at: null }).eq('id', org_id);
      await log('admin_org_unsuspended', org.name, {});
      return json(200, { ok: true });
    }
    case 'role_change': {
      const { profile_id, role } = body;
      if (!['owner', 'member'].includes(role)) return json(400, { error: 'Invalid role' });
      const { data: target } = await db.from('profiles').select('*').eq('id', profile_id).eq('org_id', org_id).single();
      if (!target) return json(404, { error: 'User not in this org' });
      if (target.role === 'owner' && role === 'member') {
        const { count } = await db.from('profiles').select('id', { count: 'exact', head: true }).eq('org_id', org_id).eq('role', 'owner');
        if ((count || 0) <= 1) return json(409, { error: 'Cannot demote the last owner' });
      }
      await db.from('profiles').update({ role }).eq('id', profile_id);
      await log('admin_role_change', target.email, { from: target.role, to: role });
      return json(200, { ok: true });
    }
    case 'remove_user': {
      const { profile_id } = body;
      const { data: target } = await db.from('profiles').select('*').eq('id', profile_id).eq('org_id', org_id).single();
      if (!target) return json(404, { error: 'User not in this org' });
      if (target.role === 'owner') {
        const { count } = await db.from('profiles').select('id', { count: 'exact', head: true }).eq('org_id', org_id).eq('role', 'owner');
        if ((count || 0) <= 1) return json(409, { error: 'Cannot remove the last owner' });
      }
      // Deliberately profiles-only: the auth.users row stays (flagged decision — see CHANGES).
      await db.from('profiles').delete().eq('id', profile_id);
      await log('admin_user_removed', target.email, { role: target.role });
      return json(200, { ok: true });
    }
    case 'revoke_ads_connection': {
      const { connection_id } = body;
      const { data: conn } = await db.from('google_ads_connections').select('id, customer_id, org_id').eq('id', connection_id).eq('org_id', org_id).single();
      if (!conn) return json(404, { error: 'Connection not found' });
      await db.from('google_ads_connections').update({ status: 'revoked' }).eq('id', connection_id);
      await log('admin_connection_revoked', conn.customer_id, { kind: 'google_ads', connection_id });
      return json(200, { ok: true });
    }
    case 'revoke_comms_connection': {
      const { connection_id } = body;
      const { data: conn } = await db.from('comms_connections').select('id, address, org_id').eq('id', connection_id).eq('org_id', org_id).single();
      if (!conn) return json(404, { error: 'Connection not found' });
      await db.from('comms_connections').update({ status: 'revoked' }).eq('id', connection_id);
      await log('admin_connection_revoked', conn.address, { kind: 'comms', connection_id });
      return json(200, { ok: true });
    }
    case 'resync': {
      const { connection_id } = body;
      const { data: conn } = await db.from('google_ads_connections').select('id, customer_id, status').eq('id', connection_id).eq('org_id', org_id).single();
      if (!conn) return json(404, { error: 'Connection not found' });
      if (conn.status !== 'active') return json(409, { error: 'Connection is not active' });
      await fetch(`${process.env.APP_URL}/.netlify/functions/sync-connection-background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SYNC_SECRET },
        body: JSON.stringify({ connection_id }),
      }).catch(() => {});
      await log('admin_resync_triggered', conn.customer_id, { connection_id });
      return json(200, { ok: true });
    }
    case 'delete_org': {
      if (org.subscription_status === 'active' && org.stripe_subscription_id)
        return json(409, { error: 'This org has an active Stripe subscription — cancel it first (Billing controls), then delete.' });
      await log('admin_org_deleted', org.name, { plan_tier: org.plan_tier, subscription_status: org.subscription_status });
      await db.from('organizations').delete().eq('id', org_id); // FK cascade wipes everything tenant-scoped
      return json(200, { ok: true });
    }
    default:
      return json(400, { error: `Unknown action: ${action}` });
  }
};
