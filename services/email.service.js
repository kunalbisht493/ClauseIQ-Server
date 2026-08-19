const { getGmailTransport } = require('../config/gmail');

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function verificationUrl(token) {
  const origin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
  return `${origin}/verify-email?token=${encodeURIComponent(token)}`;
}

function getSender() {
  const gmailUser = (process.env.GMAIL_USER || '').trim();
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;
  return `"ClauseIQ" <${gmailUser}>`;
}

async function sendVerificationEmail({ email, name, token }) {
  const url = verificationUrl(token);
  const from = getSender();

  await getGmailTransport().sendMail({
    from,
    to: email,
    subject: 'Verify your email address',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 28px; border: 1px solid #e0eae6; border-radius: 8px; background: #ffffff;">
        <div style="margin-bottom: 20px;">
          <h2 style="color: #14796f; margin: 0; font-size: 22px;">ClauseIQ</h2>
          <p style="color: #718480; font-size: 13px; margin: 4px 0 0;">Legal clarity, made simple.</p>
        </div>
        <hr style="border: 0; border-top: 1px solid #eef3f1; margin: 18px 0;" />
        <p style="color: #2b3b38; font-size: 15px; line-height: 1.5;">Hi ${escapeHtml(name)},</p>
        <p style="color: #2b3b38; font-size: 15px; line-height: 1.5;">Please click the button below to verify your email address and activate your ClauseIQ account:</p>
        <div style="margin: 26px 0;">
          <a href="${url}" style="background-color: #14796f; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 14px; display: inline-block;">Verify Email Address</a>
        </div>
        <p style="color: #718480; font-size: 13px; line-height: 1.5;">Or copy and paste this link in your browser:<br/><a href="${url}" style="color: #14796f; word-break: break-all;">${url}</a></p>
        <hr style="border: 0; border-top: 1px solid #eef3f1; margin: 24px 0 16px;" />
        <p style="color: #92a4a0; font-size: 12px; margin: 0;">This link expires in 5 minutes. If you did not sign up for ClauseIQ, you can safely ignore this email.</p>
      </div>
    `,
    text: `Hi ${name},\n\nVerify your email address: ${url}\n\nThis link expires in 5 minutes. If you did not sign up, please ignore this email.`,
  });
}

async function sendPasswordResetEmail({ email, name, token }) {
  const url = `${(process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  const from = getSender();

  await getGmailTransport().sendMail({
    from,
    to: email,
    subject: 'Reset your password',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 28px; border: 1px solid #e0eae6; border-radius: 8px; background: #ffffff;">
        <div style="margin-bottom: 20px;">
          <h2 style="color: #14796f; margin: 0; font-size: 22px;">ClauseIQ</h2>
          <p style="color: #718480; font-size: 13px; margin: 4px 0 0;">Legal clarity, made simple.</p>
        </div>
        <hr style="border: 0; border-top: 1px solid #eef3f1; margin: 18px 0;" />
        <p style="color: #2b3b38; font-size: 15px; line-height: 1.5;">Hi ${escapeHtml(name)},</p>
        <p style="color: #2b3b38; font-size: 15px; line-height: 1.5;">We received a request to reset your ClauseIQ password. Click the button below to set a new password:</p>
        <div style="margin: 26px 0;">
          <a href="${url}" style="background-color: #14796f; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 14px; display: inline-block;">Reset Password</a>
        </div>
        <p style="color: #718480; font-size: 13px; line-height: 1.5;">Or copy and paste this link in your browser:<br/><a href="${url}" style="color: #14796f; word-break: break-all;">${url}</a></p>
        <hr style="border: 0; border-top: 1px solid #eef3f1; margin: 24px 0 16px;" />
        <p style="color: #92a4a0; font-size: 12px; margin: 0;">This link expires in 5 minutes. If you did not request a password reset, please ignore this email.</p>
      </div>
    `,
    text: `Hi ${name},\n\nReset your password: ${url}\n\nThis link expires in 5 minutes. If you did not request this, please ignore this email.`,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
