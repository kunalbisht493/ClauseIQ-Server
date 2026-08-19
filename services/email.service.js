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

async function sendPasswordResetEmail({ email, name, token }) {
  const origin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
  const url = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
  await getGmailTransport().sendMail({
    from: process.env.EMAIL_FROM || process.env.GMAIL_USER,
    to: email,
    subject: 'Reset your password',
    html: `<p>Hi ${escapeHtml(name)},</p><p>Use the link below to set a new password.</p><p><a href="${url}">Reset password</a></p><p>This link expires in 5 minutes. If you did not request this, you can ignore this email.</p>`,
    text: `Hi ${name},\n\nReset your password: ${url}\n\nThis link expires in 5 minutes. If you did not request this, you can ignore this email.`,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
