// POST { address, smtp_host, smtp_port, imap_host, imap_port, username, password }
// Verifies both pipes actually work before saving — a dead mailbox should fail here, not mid-sequence.
const { getCaller, admin, encrypt, json } = require('./_shared/util');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const cfg = JSON.parse(event.body || '{}');
  for (const k of ['address', 'smtp_host', 'imap_host', 'username', 'password'])
    if (!cfg[k]) return json(400, { error: `Missing ${k}` });

  try {
    const nodemailer = require('nodemailer');
    await nodemailer.createTransport({
      host: cfg.smtp_host, port: Number(cfg.smtp_port || 587),
      secure: Number(cfg.smtp_port) === 465,
      auth: { user: cfg.username, pass: cfg.password },
    }).verify();
  } catch (e) { return json(400, { error: `SMTP check failed: ${String(e.message).slice(0, 160)}` }); }

  try {
    const { ImapFlow } = require('imapflow');
    const c = new ImapFlow({
      host: cfg.imap_host, port: Number(cfg.imap_port || 993), secure: true,
      auth: { user: cfg.username, pass: cfg.password }, logger: false,
    });
    await c.connect(); await c.logout();
  } catch (e) { return json(400, { error: `IMAP check failed: ${String(e.message).slice(0, 160)}` }); }

  const { error } = await admin().from('comms_connections').insert({
    org_id: caller.profile.org_id, kind: 'smtp_imap',
    label: cfg.label || 'Email (IMAP)', address: cfg.address.toLowerCase(),
    credentials_ciphertext: encrypt(JSON.stringify({
      smtp_host: cfg.smtp_host, smtp_port: cfg.smtp_port || 587,
      imap_host: cfg.imap_host, imap_port: cfg.imap_port || 993,
      username: cfg.username, password: cfg.password,
    })),
    connected_by: caller.user.id, last_synced_at: new Date().toISOString(),
  });
  if (error) return json(400, { error: 'Could not save (already connected?)' });
  return json(200, { ok: true });
};
