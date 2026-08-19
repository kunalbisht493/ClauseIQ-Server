jest.mock('../config/gmail', () => ({ getGmailTransport: jest.fn() }));

const { getGmailTransport } = require('../config/gmail');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/email.service');

describe('email.service', () => {
  const previousEnv = { ...process.env };

  beforeEach(() => {
    process.env.CLIENT_ORIGIN = 'https://app.example.test';
    process.env.GMAIL_USER = 'verify@example.test';
    getGmailTransport.mockReturnValue({ sendMail: jest.fn().mockResolvedValue({ messageId: 'email-id' }) });
  });

  afterEach(() => {
    process.env = { ...previousEnv };
    jest.clearAllMocks();
  });

  it('sends an expiring verification link through Gmail SMTP', async () => {
    await sendVerificationEmail({ email: 'person@example.test', name: 'Ada <Admin>', token: 'safe-token' });

    expect(getGmailTransport().sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'person@example.test',
      subject: 'Verify your email address',
      text: expect.stringContaining('https://app.example.test/verify-email?token=safe-token'),
      html: expect.stringContaining('Ada &lt;Admin&gt;'),
    }));
  });

  it('sends an expiring password reset link through Gmail SMTP with 5-minute TTL', async () => {
    await sendPasswordResetEmail({ email: 'person@example.test', name: 'Ada', token: 'reset-token-123' });

    expect(getGmailTransport().sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'person@example.test',
      subject: 'Reset your password',
      text: expect.stringContaining('https://app.example.test/reset-password?token=reset-token-123'),
      html: expect.stringContaining('This link expires in 5 minutes.'),
    }));
  });
});
