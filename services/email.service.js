const { getGmailTransport } = require('../config/gmail');

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function verificationUrl(token) {
  const origin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
  return `${origin}/verify-email?token=${encodeURIComponent(token)}`;
}

async function sendVerificationEmail({ email, name, token }) {
  const url = verificationUrl(token);
  await getGmailTransport().sendMail({
    from: process.env.EMAIL_FROM || process.env.GMAIL_USER,
    to: email,
    subject: 'Verify your email address',
    html: `<p>Hi ${escapeHtml(name)},</p><p>Please verify your email address to activate your account.</p><p><a href="${url}">Verify email address</a></p><p>This link expires in 5 minutes.</p>`,
    text: `Hi ${name},\n\nVerify your email address: ${url}\n\nThis link expires in 5 minutes.`,
  });
}

module.exports = { sendVerificationEmail };