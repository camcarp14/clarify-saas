// GET ?org_id=  -> recent invoices for that customer (read-only)
// POST { action: 'cancel_subscription', org_id } -> cancels at Stripe + updates local status
const Stripe = require('stripe');
const { getCaller, admin, json } = require('./_shared/util');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  if (!caller.profile.is_clarify_admin) return json(403, { error: 'Admins only' });
  const db = admin();

  if (event.httpMethod === 'GET') {
    const org_id = event.queryStringParameters?.org_id;
    const { data: org } = await db.from('organizations').select('stripe_customer_id').eq('id', org_id).single();
    if (!org?.stripe_customer_id) return json(200, { invoices: [], note: 'No Stripe customer yet' });
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const list = await stripe.invoices.list({ customer: org.stripe_customer_id, limit: 12 });
    return json(200, {
      invoices: list.data.map((i) => ({
        id: i.id, number: i.number, status: i.status,
        amount_due: i.amount_due, amount_paid: i.amount_paid, currency: i.currency,
        created: i.created, hosted_invoice_url: i.hosted_invoice_url,
      })),
    });
  }

  if (event.httpMethod === 'POST') {
    const { action, org_id } = JSON.parse(event.body || '{}');
    if (action !== 'cancel_subscription') return json(400, { error: 'Unknown action' });
    const { data: org } = await db.from('organizations').select('*').eq('id', org_id).single();
    if (!org) return json(404, { error: 'Org not found' });
    if (!org.stripe_subscription_id) return json(409, { error: 'No Stripe subscription on file' });
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    await stripe.subscriptions.cancel(org.stripe_subscription_id);
    await db.from('organizations').update({ subscription_status: 'canceled' }).eq('id', org_id);
    await db.from('audit_log').insert({
      actor_id: caller.user.id, org_id, action: 'admin_subscription_canceled',
      target: org.name, meta: { stripe_subscription_id: org.stripe_subscription_id },
    });
    return json(200, { ok: true });
  }
  return json(405, { error: 'GET or POST' });
};
