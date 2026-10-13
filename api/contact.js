// POST /api/contact {name,email,message,website} sends the enquiry and a confirmation by SMTP.
import nodemailer from 'nodemailer';
import { allow, send, route, readJson, rateLimit, httpError } from './_lib/http.js';

const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

function smtpConfig() {
  const { SMTP_HOST: host, SMTP_USER: user, SMTP_PASS: pass } = process.env;
  const port = Number(process.env.SMTP_PORT || 465);
  const recipient = process.env.CONTACT_EMAIL;
  const from = process.env.SMTP_FROM || user;
  if (!host || !user || !pass || !recipient || !emailPattern.test(recipient)) {
    throw httpError(503, 'email_not_configured', 'The contact service is not configured yet');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw httpError(503, 'email_not_configured', 'The contact service is not configured yet');
  }
  const secureValue = process.env.SMTP_SECURE;
  if (secureValue !== undefined && !['true', 'false'].includes(secureValue.toLowerCase())) {
    throw httpError(503, 'email_not_configured', 'The contact service is not configured yet');
  }
  if (!emailPattern.test(from)) {
    throw httpError(503, 'email_not_configured', 'The contact service is not configured yet');
  }
  const secure = secureValue === undefined ? port === 465 : secureValue.toLowerCase() === 'true';
  return { host, port, secure, user, pass, recipient, from };
}

export default route(async (req, res) => {
  if (!allow(req, res, ['POST'])) return;
  rateLimit(req, 'contact', 5, 60 * 60 * 1000);

  const body = await readJson(req, 6_000);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw httpError(400, 'invalid_input', 'Enter a valid name, email address, and message');
  }

  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const website = typeof body.website === 'string' ? body.website.trim() : '';

  if (website) return send(res, 200, { ok: true });
  if (name.length > 100 || !emailPattern.test(email) || email.length > 254 || message.length < 10 || message.length > 4_000) {
    throw httpError(400, 'invalid_input', 'Enter a valid email address and a message between 10 and 4000 characters');
  }

  const config = smtpConfig();
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  const greeting = name ? `Hi ${name},` : 'Hello,';
  const escapedMessage = escapeHtml(message).replace(/\r?\n/g, '<br>');

  try {
    await Promise.all([
      transport.sendMail({
        from: config.from,
        to: config.recipient,
        replyTo: email,
        subject: 'New portfolio enquiry',
        text: `From: ${name || 'Not provided'}\nEmail: ${email}\n\n${message}`,
        html: `<p><strong>From:</strong> ${escapeHtml(name || 'Not provided')}<br><strong>Email:</strong> ${escapeHtml(email)}</p><p>${escapedMessage}</p>`,
      }),
      transport.sendMail({
        from: config.from,
        to: email,
        subject: 'Thanks for reaching out',
        text: `${greeting}\n\nThanks for reaching out. Your message has been received, and I will get back to you as soon as I can.\n\nPrashyam Sankar Mitra`,
        html: `<p>${escapeHtml(greeting)}</p><p>Thanks for reaching out. Your message has been received, and I will get back to you as soon as I can.</p><p>Prashyam Sankar Mitra</p>`,
      }),
    ]);
  } catch (error) {
    console.error('[contact] SMTP delivery failed:', error?.code || error?.name || 'unknown error');
    throw httpError(502, 'email_delivery_failed', 'Your message could not be sent. Please try again or use the direct email link.');
  } finally {
    transport.close();
  }

  send(res, 200, { ok: true });
});
