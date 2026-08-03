jest.mock('../config/gmail', () => ({ getGmailTransport: jest.fn() }));

const { getGmailTransport } = require('../config/gmail');
const { sendVerificationEmail } = require('../services/email.service');

describe('sendVerificationEmail', () => {
  const previousEnv = { ...process.env };

  beforeEach(() => {
    process.env.API_ORIGIN = 'https://api.example.test';
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
      text: expect.stringContaining('https://api.example.test/api/auth/verify-email?token=safe-token'),
      html: expect.stringContaining('Ada &lt;Admin&gt;'),
    }));
  });
});
