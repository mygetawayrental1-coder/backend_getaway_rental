const nodemailer = require('nodemailer');

const FROM_EMAIL = process.env.BREVO_FROM_EMAIL || 'noreply@example.com';
const FROM_NAME = process.env.BREVO_FROM_NAME || 'MyGetawayRental';

const brevoApiKey = process.env.BREVO_API_KEY || '';
const smtpConfigured = Boolean(process.env.BREVO_SMTP_USER && process.env.BREVO_SMTP_PASS);
const emailConfigured = Boolean(brevoApiKey || smtpConfigured);

if (!emailConfigured) {
  console.warn(
    '[email] Set BREVO_API_KEY (recommended on Render) or BREVO_SMTP_USER + BREVO_SMTP_PASS — outbound email is disabled.',
  );
} else if (!brevoApiKey && smtpConfigured) {
  console.warn(
    '[email] Using SMTP only. On Render, SMTP often times out — set BREVO_API_KEY (Brevo → SMTP & API → API keys).',
  );
}

const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
      port: Number(process.env.BREVO_SMTP_PORT) || 587,
      secure: false,
      connectionTimeout: 15000,
      auth: {
        user: process.env.BREVO_SMTP_USER,
        pass: process.env.BREVO_SMTP_PASS,
      },
    })
  : null;

function toAddressList(value) {
  const list = Array.isArray(value) ? value : [value];
  return list.filter(Boolean).map((email) => ({ email: String(email).trim() }));
}

/** Prefer Brevo HTTPS API — Render freestyle/starter often blocks outbound SMTP :587. */
async function sendViaBrevoApi({ to, bcc, subject, html, text }) {
  const payload = {
    sender: { name: FROM_NAME, email: FROM_EMAIL },
    to: toAddressList(to),
    subject,
    htmlContent: html,
    ...(text ? { textContent: text } : {}),
    ...(bcc ? { bcc: toAddressList(bcc) } : {}),
  };

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': brevoApiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error || `Brevo API ${res.status}`;
    throw new Error(msg);
  }

  console.log(
    'Email sent via Brevo API:',
    data.messageId || data.messageIds || 'ok',
    '| to:',
    toAddressList(to).map((x) => x.email).join(', '),
    '| from:',
    FROM_EMAIL,
  );
  return data;
}

async function sendViaSmtp({ to, bcc, subject, html, text }) {
  const data = await transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to: Array.isArray(to) ? to.join(', ') : to,
    ...(bcc && { bcc: Array.isArray(bcc) ? bcc.join(', ') : bcc }),
    subject,
    text,
    html,
  });
  console.log('Email sent via Brevo SMTP:', data.messageId);
  return data;
}

const sendEmail = async ({ to, bcc, subject, html, text }) => {
  if (!emailConfigured) {
    throw new Error('Brevo is not configured (need BREVO_API_KEY or SMTP credentials).');
  }

  const recipients = toAddressList(to);
  if (recipients.length === 0) {
    throw new Error('Cannot send email: missing recipient address.');
  }

  try {
    if (brevoApiKey) {
      return await sendViaBrevoApi({ to: recipients.map((r) => r.email), bcc, subject, html, text });
    }
    return await sendViaSmtp({ to: recipients.map((r) => r.email), bcc, subject, html, text });
  } catch (error) {
    console.error(
      'Brevo email error:',
      error.message || error,
      '| to:',
      recipients.map((r) => r.email).join(', '),
    );
    throw error;
  }
};

const sendCustomPricingOwnerConfirmation = async (ownerEmail, ownerName, planName) => {
  try {
    const planText = planName ? ` for the ${planName} plan` : '';

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
            <h2>Request Received</h2>
            <p>Hi ${ownerName},</p>
            <p>Thank you for requesting a custom pricing offer${planText}. We have received your request and our team is currently reviewing your details.</p>
            <p>We will get back to you shortly with a personalized offer that fits your needs.</p>
            <hr style="border: none; border-top: 1px solid #eaeaea; margin: 20px 0;" />
            <p>Best regards,</p>
            <p><strong>The MyGetawayRental Team</strong></p>
            <p style="font-size: 12px; color: #888;">If you have any immediate questions, feel free to reply to this email.</p>
        </div>
    `;

    const data = await sendEmail({
      to: ownerEmail,
      subject: 'We Received Your Custom Pricing Request',
      html
    });
    console.log("Custom Pricing Confirmation email successfully sent to owner", data);
    return data;
  } catch (error) {
    console.error("Error sending custom pricing confirmation to owner:", error);
    return error;
  }
};

const sendCustomPricingAdminNotification = async (ownerName, ownerEmail, planName, requestedPrice, phone, message, numProperties) => {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'mygatewayrentals@gmail.com';
    const planText = planName || 'None Specified';

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
            <h2>New Custom Pricing Request</h2>
            <p><strong>Owner Name:</strong> ${ownerName}</p>
            <p><strong>Email Address:</strong> ${ownerEmail}</p>
            <p><strong>Phone Number:</strong> ${phone || 'Not Provided'}</p>
            <hr style="border: none; border-top: 1px solid #eaeaea; margin: 20px 0;" />
            <h3>Request Details</h3>
            <p><strong>Target Plan:</strong> ${planText}</p>
            <p><strong>Properties Count:</strong> ${numProperties}</p>
            <p><strong>Requested Price:</strong> $${requestedPrice}</p>
            <p><strong>Additional Message:</strong></p>
            <blockquote style="margin: 0; padding: 10px 15px; border-left: 4px solid #007bff; background: #f9f9f9;">
                ${message || 'No additional message provided.'}
            </blockquote>
            <hr style="border: none; border-top: 1px solid #eaeaea; margin: 20px 0;" />
            <p>Log in to the Admin Portal to manage this request.</p>
        </div>
    `;

    const data = await sendEmail({
      to: adminEmail,
      subject: `New Custom Pricing Request from ${ownerName}`,
      html
    });
    console.log("Custom Pricing Notification email successfully sent to Admin", data);
    return data;
  } catch (error) {
    console.error("Error sending custom pricing notification to admin:", error);
    return error;
  }
};

const sendVerificationEmail = async (email, token) => {
  const verifyUrl = `${process.env.APP_URL}/auth/verify-email/${token}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #10B981;">Welcome to MyGatewayRental!</h2>
      <p>Thank you for registering. Please verify your email address by clicking the button below:</p>
      <a href="${verifyUrl}" style="display: inline-block; background-color: #10B981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">
        Verify Email
      </a>
      <p>Or copy and paste this link in your browser:</p>
      <p style="color: #666; word-break: break-all;">${verifyUrl}</p>
      <p>This link will expire in 24 hours.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
      <p style="color: #999; font-size: 12px;">If you didn't create an account, please ignore this email.</p>
    </div>
  `;

  return sendEmail({
    to: email,
    subject: 'Verify your email - MyGatewayRental',
    html,
    text: `Welcome to MyGatewayRental! Verify your email: ${verifyUrl}`,
  });
};

const sendPasswordResetEmail = async (email, token) => {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #10B981;">Password Reset Request</h2>
      <p>You have requested to reset your password. Click the button below to proceed:</p>
      <a href="${resetUrl}" style="display: inline-block; background-color: #10B981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">
        Reset Password
      </a>
      <p>Or copy and paste this link in your browser:</p>
      <p style="color: #666; word-break: break-all;">${resetUrl}</p>
      <p><strong>This link will expire in 1 hour.</strong></p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
      <p style="color: #999; font-size: 12px;">If you didn't request this, please ignore this email. Your password will remain unchanged.</p>
    </div>
  `;

  return sendEmail({
    to: email,
    subject: 'Reset your password - MyGatewayRental',
    html,
    text: `Reset your password: ${resetUrl}`,
  });
};

const sendInquiryNotification = async (ownerEmail, inquiry) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #10B981;">New Booking Inquiry!</h2>
      <p>You have received a new booking inquiry for your property.</p>
      <div style="background-color: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p><strong>Property:</strong> ${inquiry.propertyName}</p>
        <p><strong>Guest Name:</strong> ${inquiry.fullName}</p>
        <p><strong>Email:</strong> ${inquiry.email}</p>
        <p><strong>Phone:</strong> ${inquiry.phone || 'Not provided'}</p>
        <p><strong>Check-in:</strong> ${inquiry.checkin}</p>
        <p><strong>Check-out:</strong> ${inquiry.checkout}</p>
        <p><strong>Guests:</strong> ${inquiry.guests}</p>
        <p><strong>Message:</strong> ${inquiry.message || 'No message'}</p>
      </div>
      <p>Log in to your dashboard to respond to this inquiry.</p>
    </div>
  `;

  return sendEmail({
    to: ownerEmail,
    subject: `New Inquiry for ${inquiry.propertyName} - MyGatewayRental`,
    html,
    text: `New booking inquiry from ${inquiry.fullName} for ${inquiry.propertyName}`,
  });
};

function formatRequestDate(value) {
  if (!value) return 'Flexible';
  try {
    return new Date(value).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return String(value);
  }
}

/** Adults / children / pets line for guest-request emails. */
function formatGuestPartyHtml(request) {
  const adults = Number(request.adults);
  const children = Number(request.children);
  const pets = Number(request.pets);
  const hasBreakdown =
    Number.isFinite(adults) || Number.isFinite(children) || Number.isFinite(pets);

  if (!hasBreakdown) {
    return `<p><strong>Guests:</strong> ${request.guests || 1}</p>`;
  }

  const a = Number.isFinite(adults) ? Math.max(0, adults) : Math.max(1, Number(request.guests) || 1);
  const c = Number.isFinite(children) ? Math.max(0, children) : 0;
  const p = Number.isFinite(pets) ? Math.max(0, pets) : 0;
  const totalPeople = a + c;

  return `
        <p><strong>Guests:</strong> ${totalPeople || request.guests || 1}</p>
        <p><strong>Adults:</strong> ${a}</p>
        <p><strong>Children:</strong> ${c}</p>
        <p><strong>Pets:</strong> ${p}</p>`;
}

function formatGuestPartyText(request) {
  const adults = Number(request.adults);
  const children = Number(request.children);
  const pets = Number(request.pets);
  if (!Number.isFinite(adults) && !Number.isFinite(children) && !Number.isFinite(pets)) {
    return `Guests: ${request.guests || 1}`;
  }
  const a = Number.isFinite(adults) ? Math.max(0, adults) : Math.max(1, Number(request.guests) || 1);
  const c = Number.isFinite(children) ? Math.max(0, children) : 0;
  const p = Number.isFinite(pets) ? Math.max(0, pets) : 0;
  return `Guests: ${a + c} (Adults: ${a}, Children: ${c}, Pets: ${p})`;
}

function formatCustomFieldsHtml(request) {
  const fields = request.customFields;
  if (!fields || typeof fields !== 'object') return '';
  const labels = request.customFieldLabels || {};
  const entries = Object.entries(fields);
  if (!entries.length) return '';
  return entries
    .map(([key, val]) => {
      const label = labels[key] || key;
      const display = typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val);
      return `<p><strong>${label}:</strong> ${display}</p>`;
    })
    .join('\n');
}

const sendGuestRequestNotification = async (ownerEmail, request) => {
  const ownerPhone = request.ownerPhone || 'Not on file';
  const guestPhone = request.phone || 'Not provided';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ED8323;">New rent request</h2>
      <p>A guest submitted a rental request for your property. Details are below — you can also manage this in your owner dashboard.</p>
      <div style="background-color: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p><strong>Property:</strong> ${request.propertyName}</p>
        <p><strong>Guest name:</strong> ${request.fullName}</p>
        <p><strong>Guest email:</strong> ${request.email}</p>
        <p><strong>Guest phone:</strong> ${guestPhone}</p>
        <p><strong>Your phone on file:</strong> ${ownerPhone}</p>
        <p><strong>Check-in:</strong> ${formatRequestDate(request.checkin)}</p>
        <p><strong>Check-out:</strong> ${formatRequestDate(request.checkout)}</p>
        ${formatGuestPartyHtml(request)}
        ${formatCustomFieldsHtml(request)}
        ${
          request.quotedTotal != null
            ? `<p><strong>Quoted total (estimate):</strong> $${Number(request.quotedTotal).toFixed(2)}</p>
        <p style="color:#6b7280;font-size:13px;"><em>${request.quoteNote || 'This is a temporary estimate and can change after discussions with the owner.'}</em></p>`
            : ''
        }
        <p><strong>Message:</strong> ${request.message || 'No message'}</p>
      </div>
      <p>Sign in to your dashboard to accept or decline this request.</p>
    </div>
  `;

  return sendEmail({
    to: ownerEmail,
    subject: `New rent request — ${request.propertyName}`,
    html,
    text: `New rent request from ${request.fullName} (${guestPhone}) for ${request.propertyName} | ${formatGuestPartyText(request)}${
      request.quotedTotal != null
        ? ` | Quoted total (temporary): $${Number(request.quotedTotal).toFixed(2)}`
        : ''
    }`,
  });
};

const sendGuestRequestConfirmationToGuest = async (guestEmail, request) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ED8323;">Request received</h2>
      <p>Hi ${request.fullName},</p>
      <p>Your rental request for <strong>${request.propertyName}</strong> was submitted successfully. The property owner will review it and respond by email.</p>
      <div style="background-color: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p><strong>Check-in:</strong> ${formatRequestDate(request.checkin)}</p>
        <p><strong>Check-out:</strong> ${formatRequestDate(request.checkout)}</p>
        ${formatGuestPartyHtml(request)}
        ${formatCustomFieldsHtml(request)}
        ${
          request.quotedTotal != null
            ? `<p><strong>Quoted total (estimate):</strong> $${Number(request.quotedTotal).toFixed(2)}</p>
        <p style="color:#6b7280;font-size:13px;"><em>${request.quoteNote || 'This is a temporary estimate and can change after discussions with the owner.'}</em></p>`
            : ''
        }
      </div>
      <p>Thank you for using MyGetawayRental.</p>
    </div>
  `;

  return sendEmail({
    to: guestEmail,
    subject: `We received your request — ${request.propertyName}`,
    html,
    text: `Your rental request for ${request.propertyName} was submitted.${
      request.quotedTotal != null
        ? ` Quoted total (temporary): $${Number(request.quotedTotal).toFixed(2)}.`
        : ''
    }`,
  });
};

function buildPaymentInstructionsBlocks(owner) {
  let instructionsHtml = '<p>Please contact the owner for payment instructions.</p>';
  let instructionsText = 'Please contact the owner for payment instructions.';

  if (!owner?.paymentInstructions) {
    return { instructionsHtml, instructionsText };
  }

  try {
    const parsed = JSON.parse(owner.paymentInstructions);

    const titles = {
      cards: 'Credit & Debit Cards',
      wallets: 'Digital Wallets',
      p2p: 'P2P Apps (Venmo, Zelle, CashApp)',
      bank: 'Bank Transfers',
      bnpl: 'Buy Now, Pay Later',
      cash: 'Cash',
    };

    const enabled = Object.entries(parsed).filter(
      ([, config]) => config?.enabled && String(config.info || '').trim(),
    );

    if (enabled.length > 0) {
      instructionsHtml = enabled
        .map(([key, config]) => {
          const title = titles[key] || 'Other';
          return `
            <div style="margin-bottom: 12px;">
              <strong style="display: block; color: #1e293b; margin-bottom: 4px;">${title}</strong>
              <div style="white-space: pre-wrap; color: #475569;">${config.info}</div>
            </div>
          `;
        })
        .join('');
      instructionsText = enabled
        .map(([key, config]) => `${titles[key] || 'Other'}:\n${config.info}`)
        .join('\n\n');
    } else {
      instructionsHtml =
        '<p>The owner has not specified any payment methods. Please contact them directly.</p>';
      instructionsText =
        'The owner has not specified any payment methods. Please contact them directly.';
    }
  } catch {
    instructionsHtml = `<div style="white-space: pre-wrap;">${owner.paymentInstructions}</div>`;
    instructionsText = owner.paymentInstructions;
  }

  return { instructionsHtml, instructionsText };
}

const sendGuestRequestAcceptedToGuest = async (guestEmail, request, owner = null) => {
  const { instructionsHtml, instructionsText } = buildPaymentInstructionsBlocks(owner);
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #22c55e;">Booking confirmed</h2>
      <p>Hi ${request.fullName},</p>
      <p>Good news — the owner confirmed your rental for <strong>${request.propertyName}</strong>.</p>
      <div style="background-color: #f0fdf4; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p><strong>Check-in:</strong> ${formatRequestDate(request.checkin)}</p>
        <p><strong>Check-out:</strong> ${formatRequestDate(request.checkout)}</p>
        ${formatGuestPartyHtml(request)}
      </div>
      <h3 style="color: #0f172a;">How to pay</h3>
      <div style="background-color: #fff8e1; padding: 16px; border-radius: 8px; border-left: 4px solid #f59e0b; margin: 16px 0;">
        ${instructionsHtml}
      </div>
      <p>Once you pay, the owner will confirm receipt. Reply to this email if you have questions.</p>
    </div>
  `;

  return sendEmail({
    to: guestEmail,
    subject: `Confirmed — ${request.propertyName}`,
    html,
    text: `Your rental for ${request.propertyName} was confirmed.\n\nPayment instructions:\n\n${instructionsText}`,
  });
};

const sendGuestRequestRejectedToGuest = async (guestEmail, request) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #6b7280;">Request update</h2>
      <p>Hi ${request.fullName},</p>
      <p>Unfortunately, the owner is unable to accommodate your request for <strong>${request.propertyName}</strong> at this time.</p>
      <p>Browse other stays on MyGetawayRental — we're happy to help you find another option.</p>
    </div>
  `;

  return sendEmail({
    to: guestEmail,
    subject: `Update on your request — ${request.propertyName}`,
    html,
    text: `Your rental request for ${request.propertyName} was declined.`,
  });
};

const sendInquiryConfirmationToGuest = async (guestEmail, inquiry) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #10B981;">Booking Inquiry Submitted!</h2>
      <p>Hi ${inquiry.fullName},</p>
      <p>Your booking inquiry for <strong>${inquiry.propertyName}</strong> has been successfully submitted to the host. They will review your request and get back to you soon.</p>
      <div style="background-color: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p><strong>Property:</strong> ${inquiry.propertyName}</p>
        <p><strong>Check-in:</strong> ${inquiry.checkin}</p>
        <p><strong>Check-out:</strong> ${inquiry.checkout}</p>
        <p><strong>Guests:</strong> ${inquiry.guests}</p>
      </div>
      <p>Thank you for using MyGatewayRental!</p>
    </div>
  `;

  return sendEmail({
    to: guestEmail,
    subject: `Booking Inquiry Submitted: ${inquiry.propertyName}`,
    html,
    text: `Your booking inquiry for ${inquiry.propertyName} has been submitted to the host.`,
  });
};

const sendInquiryAcceptedNotification = async (guestEmail, inquiry) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #10B981;">Your Booking Inquiry was Accepted! 🎉</h2>
      <p>Hi ${inquiry.fullName},</p>
      <p>Great news! The host has accepted your booking inquiry for <strong>${inquiry.propertyName}</strong>.</p>
      <div style="background-color: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p><strong>Property:</strong> ${inquiry.propertyName}</p>
        <p><strong>Check-in:</strong> ${inquiry.checkin ? new Date(inquiry.checkin).toLocaleDateString() : ''}</p>
        <p><strong>Check-out:</strong> ${inquiry.checkout ? new Date(inquiry.checkout).toLocaleDateString() : ''}</p>
        <p><strong>Total Amount:</strong> $${inquiry.totalAmount}</p>
      </div>
      <p>Please log in to your account to complete your booking and payment.</p>
    </div>
  `;

  return sendEmail({
    to: guestEmail,
    subject: `Inquiry Accepted: ${inquiry.propertyName}`,
    html,
    text: `Your booking inquiry for ${inquiry.propertyName} has been accepted by the host.`,
  });
};

const sendInquiryRejectedNotification = async (guestEmail, inquiry) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #EF4444;">Update on your Booking Inquiry</h2>
      <p>Hi ${inquiry.fullName},</p>
      <p>Unfortunately, the host is unable to accommodate your booking for <strong>${inquiry.propertyName}</strong> at this time, and your inquiry has been declined.</p>
      <p>We encourage you to browse other amazing properties available on MyGatewayRental for your dates!</p>
    </div>
  `;

  return sendEmail({
    to: guestEmail,
    subject: `Update regarding your inquiry for ${inquiry.propertyName}`,
    html,
    text: `Your booking inquiry for ${inquiry.propertyName} has been declined.`,
  });
};

const sendPaymentPendingEmail = async (guestEmail, booking, owner) => {
  const { instructionsHtml, instructionsText } = buildPaymentInstructionsBlocks(owner);

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #10B981;">Booking Confirmed! Payment Pending</h2>
      <p>Hi ${booking.guestName},</p>
      <p>Your booking for <strong>${booking.property?.propertyName || 'the property'}</strong> has been confirmed by the owner!</p>
      <div style="background-color: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p><strong>Check-in:</strong> ${new Date(booking.checkin).toLocaleDateString()}</p>
        <p><strong>Check-out:</strong> ${new Date(booking.checkout).toLocaleDateString()}</p>
        <p><strong>Total Amount:</strong> $${booking.totalAmount}</p>
      </div>
      <h3>How to Pay:</h3>
      <div style="background-color: #fff8e1; padding: 16px; border-radius: 8px; border-left: 4px solid #f59e0b; margin: 16px 0;">
        ${instructionsHtml}
      </div>
      <p>Once you make a payment, the owner will log it and you will receive a confirmation email.</p>
    </div>
  `;

  return sendEmail({
    to: guestEmail,
    subject: `Payment Pending: Booking Confirmed for ${booking.property?.propertyName || 'Property'}`,
    html,
    text: `Your booking is confirmed.\n\nPayment instructions:\n\n${instructionsText}`,
  });
};

const sendPaymentConfirmationEmail = async (guestEmail, booking, payment, totalPaid, balance) => {
  const isFull = balance <= 0;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #3b82f6;">Payment Received</h2>
      <p>Hi ${booking.guestName},</p>
      <p>We received your payment of <strong>$${payment.amount}</strong> for your booking at <strong>${booking.property?.propertyName || 'the property'}</strong>.</p>
      <div style="background-color: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p><strong>Payment Amount:</strong> $${payment.amount}</p>
        <p><strong>Total Paid So Far:</strong> $${totalPaid}</p>
        <p><strong>Remaining Balance:</strong> $${Math.max(0, balance)}</p>
        <p><strong>Date Logged:</strong> ${new Date(payment.paidAt).toLocaleDateString()}</p>
      </div>
      <p>${isFull ? 'Your booking is now fully paid. You will receive an invoice shortly.' : 'Please follow the owner payment instructions to pay the remaining balance.'}</p>
    </div>
  `;

  return sendEmail({
    to: guestEmail,
    subject: `Payment Received - $${payment.amount}`,
    html,
    text: `We received your payment of $${payment.amount}. Total Paid: $${totalPaid}. Balance: $${balance}.`,
  });
};

const sendInvoiceEmail = async (guestEmail, booking, payments) => {
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const paymentRows = payments.map(p => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${new Date(p.paidAt).toLocaleDateString()}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${p.paymentMethod}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">$${p.amount}</td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #10B981;">Invoice - Paid in Full</h2>
      <p>Hi ${booking.guestName},</p>
      <p>Your booking for <strong>${booking.property?.propertyName || 'the property'}</strong> is fully paid. Here is your final invoice.</p>
      
      <div style="background-color: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p><strong>Booking Reference:</strong> ${booking.id}</p>
        <p><strong>Check-in:</strong> ${new Date(booking.checkin).toLocaleDateString()}</p>
        <p><strong>Check-out:</strong> ${new Date(booking.checkout).toLocaleDateString()}</p>
        <p><strong>Total Booking Amount:</strong> $${booking.totalAmount}</p>
      </div>

      <h3 style="margin-top: 24px;">Payment History</h3>
      <table style="width: 100%; text-align: left; border-collapse: collapse; margin-top: 8px;">
        <thead>
          <tr style="background-color: #f1f5f9;">
            <th style="padding: 8px; border-bottom: 1px solid #cbd5e1;">Date</th>
            <th style="padding: 8px; border-bottom: 1px solid #cbd5e1;">Method</th>
            <th style="padding: 8px; border-bottom: 1px solid #cbd5e1;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${paymentRows}
        </tbody>
      </table>
      
      <div style="text-align: right; margin-top: 16px;">
        <p><strong>Total Paid:</strong> $${totalPaid}</p>
        <p><strong>Balance:</strong> $0.00</p>
      </div>
      
      <p style="margin-top: 24px;">Thank you for your business!</p>
    </div>
  `;

  return sendEmail({
    to: guestEmail,
    subject: `Invoice: Paid in Full - ${booking.property?.propertyName || 'Property'}`,
    html,
    text: `Your booking is fully paid. Invoice attached in HTML.`,
  });
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const sendBroadcastEmail = async (emailAddresses, subject, messageBody) => {
  const safeSubject = escapeHtml(subject);
  const safeBody = escapeHtml(messageBody);
  const html = `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
      <div style="background-color: #4f46e5; padding: 24px; text-align: center; border-top-left-radius: 8px; border-top-right-radius: 8px;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px;">MyGetawayRental</h1>
      </div>
      <div style="padding: 32px; background-color: #ffffff; border: 1px solid #e2e8f0; border-top: none; border-bottom-left-radius: 8px; border-bottom-right-radius: 8px;">
        <h2 style="color: #0f172a; margin-top: 0;">${safeSubject}</h2>
        <div style="color: #334155; line-height: 1.6; white-space: pre-wrap;">${safeBody}</div>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;" />
        <p style="margin: 0; color: #64748b; font-size: 14px;">Best regards,<br><strong>The MyGetawayRental Team</strong></p>
      </div>
      <div style="text-align: center; margin-top: 16px; color: #94a3b8; font-size: 12px;">
        <p>You are receiving this email because you are registered on MyGetawayRental.</p>
      </div>
    </div>
  `;

  // We can pass an array of emails to the 'to' field. Brevo will BCC them if we format it properly,
  // or we can just send it as 'bcc' to avoid exposing emails to everyone.
  // Actually, to be safe, we will use 'bcc' for mass broadcasts and a generic 'to'.
  
  return sendEmail({
    to: '"MyGetawayRental Members" <noreply@mygetawayrental.com>', // Masked To
    bcc: emailAddresses,
    subject: subject,
    html,
    text: messageBody,
  }).catch(err => {
    console.error("Error sending broadcast email batch:", err);
  });
};

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendInquiryNotification,
  sendGuestRequestNotification,
  sendGuestRequestConfirmationToGuest,
  sendGuestRequestAcceptedToGuest,
  sendGuestRequestRejectedToGuest,
  sendInquiryConfirmationToGuest,
  sendInquiryAcceptedNotification,
  sendInquiryRejectedNotification,
  sendCustomPricingOwnerConfirmation,
  sendCustomPricingAdminNotification,
  sendPaymentPendingEmail,
  sendPaymentConfirmationEmail,
  sendInvoiceEmail,
  sendBroadcastEmail,
};
