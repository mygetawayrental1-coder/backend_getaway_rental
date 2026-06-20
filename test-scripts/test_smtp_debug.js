require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
  port: Number(process.env.BREVO_SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_PASS,
  },
  debug: true,   // show full SMTP conversation
  logger: true,  // log to console
});

async function test() {
  console.log('=== SMTP Config ===');
  console.log('Host:', process.env.BREVO_SMTP_HOST);
  console.log('User:', process.env.BREVO_SMTP_USER);
  console.log('From:', process.env.BREVO_FROM_EMAIL || 'noreply@mygetawayrental.com');
  console.log('');

  try {
    const info = await transporter.sendMail({
      from: `"MyGetawayRental" <${process.env.BREVO_FROM_EMAIL || 'noreply@mygetawayrental.com'}>`,
      to: 'mdkabir3350@gmail.com',
      subject: 'SMTP Debug Test - ' + new Date().toISOString(),
      text: 'If you receive this, Brevo SMTP is working correctly.',
      html: '<p>If you receive this, <b>Brevo SMTP</b> is working correctly.</p>',
    });

    console.log('\n=== Result ===');
    console.log('Message ID:', info.messageId);
    console.log('Response:', info.response);
    console.log('Accepted:', info.accepted);
    console.log('Rejected:', info.rejected);
    console.log('Envelope:', info.envelope);
  } catch (err) {
    console.error('\n=== ERROR ===');
    console.error('Code:', err.code);
    console.error('Response:', err.response);
    console.error('Message:', err.message);
  }

  process.exit(0);
}

test();
