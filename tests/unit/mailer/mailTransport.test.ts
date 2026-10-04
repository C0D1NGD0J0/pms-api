import { MailService } from '@mailer/config.mailer';

describe('MailService transport under tests', () => {
  it('uses the no-network JSON transport, so tests never reach the dev SMTP inbox', async () => {
    const transporter = (new MailService() as any).transporter;

    // jsonTransport returns the built message instead of delivering it
    const info = await transporter.sendMail({
      from: 'app@example.com',
      to: 'tenant@test.com',
      subject: 'Lease Termination Notice',
      text: 'test',
    });

    expect(transporter.transporter.name).toBe('JSONTransport');
    expect(JSON.parse(info.message)).toEqual(
      expect.objectContaining({ subject: 'Lease Termination Notice' })
    );
  });
});
