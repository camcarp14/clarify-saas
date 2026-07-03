// Stripe -> Supabase sync. Signature-verified, idempotent via stripe_events table.
const Stripe = require('stripe');
const { admin, json, CREDITS_BY_TIER } = require('./_shared/util');

const tierFromPrice = (priceId) => ({
  [process.env.STRIPE_PRICE_STARTER]: 'starter',
  [process.env.STRIPE_PRICE_GROWTH]: 'growth',
  [process.env.STRIPE_PRICE_PRO]: 'pro',
}[priceId] || null);

exports.handler = async (event) => {
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  let evt;
  try {
    evt = stripe.webhooks.constructEvent(
      event.body, event.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return json(400, { error: `Bad signature: ${err.message}` });
  }
  const db = admin();
  const { error: dup } = await db.from('stripe_events').insert({ id: evt.id });
  if (dup) return json(200, { ok: true, duplicate: true });

  const upd = async (customerId, patch) =>
    db.from('organizations').update(patch).eq('stripe_customer_id', customerId);

  switch (evt.type) {
    case 'checkout.session.completed': {
      const s = evt.data.object;
      const sub = await stripe.subscriptions.retrieve(s.subscription);
      const tier = tierFromPrice(sub.items.data[0]?.price?.id);
      await db.from('organizations').update({
        stripe_customer_id: s.customer,
        stripe_subscription_id: s.subscription,
        subscription_status: 'active',
        // fresh credit allowance the moment someone actually pays, regardless of trial usage
        credits_used: 0, period_started_at: new Date().toISOString(),
        ...(tier ? { plan_tier: tier, monthly_credits: CREDITS_BY_TIER[tier] } : {}),
      }).eq('id', s.client_reference_id);
      break;
    }
    case 'customer.subscription.updated': {
      const sub = evt.data.object;
      const tier = tierFromPrice(sub.items.data[0]?.price?.id);
      await upd(sub.customer, {
        subscription_status: sub.status === 'trialing' ? 'trialing' : sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : sub.status,
        stripe_subscription_id: sub.id,
        // plan changes (upgrade/downgrade) re-map the outreach credit allowance too — one tier, both modules
        ...(tier ? { plan_tier: tier, monthly_credits: CREDITS_BY_TIER[tier] } : {}),
      });
      break;
    }
    case 'customer.subscription.deleted': {
      await upd(evt.data.object.customer, { subscription_status: 'canceled' });
      break;
    }
    case 'invoice.payment_failed': {
      await upd(evt.data.object.customer, { subscription_status: 'past_due' });
      break;
    }
  }
  return json(200, { received: true });
};
