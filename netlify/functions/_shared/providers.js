// Provider layer. One contract, four implementations:
//   send({ conn, credentials, to, subject, text, inReplyTo, references }) -> { providerId, rfcMessageId }
//   pullInbound({ conn, credentials, sinceIso }) -> [{ providerId, fromEmail, subject, snippet, rfcMessageId, inReplyTo, references, occurredAt }]
// Every message the platform touches flows through here — the UI never knows which pipe it rode.
const crypto = require('crypto');

const genMessageId = (fromAddress) =>
  `<${crypto.randomUUID()}@${(fromAddress.split('@')[1] || 'clarify.outreach')}>`;

const parseFrom = (h) => {
  const m = String(h || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(h || '').trim()).toLowerCase();
};

// ---------------- GMAIL ----------------
async function gmailAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gmail token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

function buildMime({ from, to, subject, text, messageId, inReplyTo, references }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject || ''}`,
    `Message-ID: ${messageId}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    text,
  ].filter((l) => l !== null);
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

const gmail = {
  async send({ conn, credentials, to, subject, text, inReplyTo, references }) {
    const token = await gmailAccessToken(credentials.refresh_token);
    const messageId = genMessageId(conn.address);
    const raw = buildMime({ from: conn.address, to, subject, text, messageId, inReplyTo, references });
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Gmail send failed: ${JSON.stringify(data).slice(0, 300)}`);
    return { providerId: data.id, rfcMessageId: messageId };
  },
  async pullInbound({ credentials, sinceIso }) {
    const token = await gmailAccessToken(credentials.refresh_token);
    const after = Math.floor(new Date(sinceIso).getTime() / 1000);
    const list = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(`in:inbox after:${after}`)}&maxResults=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    ).then((r) => r.json());
    const out = [];
    for (const m of list.messages || []) {
      const msg = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=In-Reply-To&metadataHeaders=References`,
        { headers: { Authorization: `Bearer ${token}` } }
      ).then((r) => r.json());
      const h = Object.fromEntries((msg.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
      out.push({
        providerId: m.id,
        fromEmail: parseFrom(h.from),
        subject: h.subject || '',
        snippet: msg.snippet || '',
        rfcMessageId: h['message-id'] || null,
        inReplyTo: h['in-reply-to'] || null,
        references: h.references || null,
        occurredAt: new Date(Number(msg.internalDate || Date.now())).toISOString(),
      });
    }
    return out;
  },
};

// ---------------- OUTLOOK (Microsoft Graph) ----------------
async function msAccessToken(refreshToken) {
  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID,
      client_secret: process.env.MS_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'offline_access Mail.Send Mail.Read User.Read',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Outlook token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

const outlook = {
  async send({ conn, credentials, to, subject, text }) {
    const token = await msAccessToken(credentials.refresh_token);
    // Graph assigns its own internetMessageId on sendMail; reply-matching for Outlook
    // leans on sender-email matching (see inbox-sync), which is the robust cross-provider net anyway.
    const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: subject || '',
          body: { contentType: 'Text', content: text },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) throw new Error(`Outlook send failed: ${(await res.text()).slice(0, 300)}`);
    return { providerId: null, rfcMessageId: genMessageId(conn.address) };
  },
  async pullInbound({ credentials, sinceIso }) {
    const token = await msAccessToken(credentials.refresh_token);
    const url = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$filter=receivedDateTime ge ${encodeURIComponent(sinceIso)}&$select=id,from,subject,bodyPreview,internetMessageId,receivedDateTime&$top=50&$orderby=receivedDateTime desc`;
    const data = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    return (data.value || []).map((m) => ({
      providerId: m.id,
      fromEmail: (m.from?.emailAddress?.address || '').toLowerCase(),
      subject: m.subject || '',
      snippet: m.bodyPreview || '',
      rfcMessageId: m.internetMessageId || null,
      inReplyTo: null,
      references: null,
      occurredAt: m.receivedDateTime,
    }));
  },
};

// ---------------- SMTP / IMAP (any other inbox) ----------------
const smtpImap = {
  async send({ conn, credentials, to, subject, text, inReplyTo, references }) {
    const nodemailer = require('nodemailer');
    const t = nodemailer.createTransport({
      host: credentials.smtp_host,
      port: Number(credentials.smtp_port || 587),
      secure: Number(credentials.smtp_port) === 465,
      auth: { user: credentials.username, pass: credentials.password },
    });
    const messageId = genMessageId(conn.address);
    await t.sendMail({
      from: conn.address, to, subject: subject || '', text,
      messageId, inReplyTo: inReplyTo || undefined, references: references || undefined,
    });
    return { providerId: null, rfcMessageId: messageId };
  },
  async pullInbound({ credentials, sinceIso }) {
    const { ImapFlow } = require('imapflow');
    const client = new ImapFlow({
      host: credentials.imap_host,
      port: Number(credentials.imap_port || 993),
      secure: true,
      auth: { user: credentials.username, pass: credentials.password },
      logger: false,
    });
    const out = [];
    await client.connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const uids = await client.search({ since: new Date(sinceIso) }, { uid: true });
        for await (const msg of client.fetch(
          (uids || []).slice(-50), { envelope: true, internalDate: true, uid: true }, { uid: true }
        )) {
          const env = msg.envelope || {};
          out.push({
            providerId: String(msg.uid),
            fromEmail: (env.from?.[0]?.address || '').toLowerCase(),
            subject: env.subject || '',
            snippet: '',
            rfcMessageId: env.messageId || null,
            inReplyTo: env.inReplyTo || null,
            references: null,
            occurredAt: (msg.internalDate || new Date()).toISOString(),
          });
        }
      } finally { lock.release(); }
    } finally { await client.logout().catch(() => {}); }
    return out;
  },
};

// ---------------- TWILIO SMS ----------------
const sms = {
  async send({ conn, credentials, to, text }) {
    const auth = Buffer.from(`${credentials.account_sid}:${credentials.auth_token}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${credentials.account_sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: conn.address, To: to, Body: text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`SMS send failed: ${JSON.stringify(data).slice(0, 300)}`);
    return { providerId: data.sid, rfcMessageId: null };
  },
  async pullInbound() { return []; }, // inbound SMS arrives via the twilio-inbound webhook instead
};

const PROVIDERS = { gmail, outlook, smtp_imap: smtpImap, sms_twilio: sms };
const providerFor = (conn) => {
  const p = PROVIDERS[conn.kind];
  if (!p) throw new Error(`Unknown connection kind: ${conn.kind}`);
  return p;
};

module.exports = { providerFor, gmailAccessToken, msAccessToken };
