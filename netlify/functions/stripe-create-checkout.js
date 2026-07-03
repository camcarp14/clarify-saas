// POST { tier } -> Stripe Checkout session URL. Tier gates + trial handled by webhook sync.
const Stripe = require('stripe');
const { getCaller, admin, json } = require('./_shared/util');

const PRICE = () => ({
  starter: process.env.STRIPE_PRICE_STARTER,
  growth: process.env.STRIPE_PRICE_GROWTH,
  pro: process.env.STRIPE_PRICE_PRO,
});

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const { tier } = JSON.parse(event.body || '{}');
  const price = PRICE()[tier];
  if (!price) return json(400, { error: 'Unknown tier' });

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const db = admin();
  const { data: org } = await db.from('organizations').select('*').eq('id', caller.profile.org_id).single();

  let customer = org.stripe_customer_id;
  if (!customer) {
    const c = await stripe.customers.create({ email: caller.profile.email, name: org.name, metadata: { org_id: org.id } });
    customer = c.id;
    await db.from('organizations').update({ stripe_customer_id: customer }).eq('id', org.id);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: org.id,
    line_items: [{ price, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${process.env.APP_URL}/settings?checkout=success`,
    cancel_url: `${process.env.APP_URL}/settings?checkout=canceled`,
  });
  return json(200, { url: session.url });
};
