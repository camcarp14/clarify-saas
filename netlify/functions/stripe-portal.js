// POST -> Stripe customer portal URL for managing/canceling the subscription
const Stripe = require('stripe');
const { getCaller, admin, json } = require('./_shared/util');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const { data: org } = await admin().from('organizations').select('stripe_customer_id').eq('id', caller.profile.org_id).single();
  if (!org?.stripe_customer_id) return json(400, { error: 'No billing account yet' });
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${process.env.APP_URL}/settings`,
  });
  return json(200, { url: session.url });
};
