const nodemailer = require('nodemailer');

function getGmailTransport() {
  const user = process.env.GMAIL_USER ? process.env.GMAIL_USER.trim() : '';
  const rawPass = process.env.GMAIL_APP_PASSWORD ? process.env.GMAIL_APP_PASSWORD.trim() : '';
  const pass = rawPass.replace(/\s+/g, '');

  if (!user || !pass) {
    throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD are required for email verification');
  }

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // SSL
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

module.exports = { getGmailTransport };
