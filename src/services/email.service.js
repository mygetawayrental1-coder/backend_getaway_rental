const nodemailer = require('nodemailer');

const brevoConfigured = Boolean(process.env.BREVO_SMTP_USER && process.env.BREVO_SMTP_PASS);

if (!brevoConfigured) {
  console.warn(
    '[email] BREVO_SMTP_USER and BREVO_SMTP_PASS must be set in .env — outbound email is disabled.',
  );
}

const transporter = nodemailer.createTransport({
  host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
  port: Number(process.env.BREVO_SMTP_PORT) || 587,
  secure: false,
  auth: brevoConfigured
    ? {
        user: process.env.BREVO_SMTP_USER,
        pass: process.env.BREVO_SMTP_PASS,
      }
    : undefined,
});

const FROM_EMAIL = process.env.BREVO_FROM_EMAIL || 'noreply@example.com';
const FROM_NAME = process.env.BREVO_FROM_NAME || 'MyGetawayRental';

// Generic Send email wrapper
const sendEmail = async ({ to, subject, html, text }) => {
  if (!brevoConfigured) {
    throw new Error('Brevo SMTP is not configured.');
  }
  try {
    const mailOptions = {
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`, // sender address
      to: Array.isArray(to) ? to.join(', ') : to, // list of receivers
      subject: subject,
      text: text, // plain text body
      html: html, // html body
    };

    const data = await transporter.sendMail(mailOptions);
    console.log('Email sent via Brevo SMTP:', data.messageId);
    return data;
  } catch (error) {
    console.error('Brevo SMTP email error:', error);
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

// Send email verification
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

// Send password reset email
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

// Send inquiry notification to owner
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

// Notify owner by email (guest rent request)
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
        <p><strong>Guests:</strong> ${request.guests || 1}</p>
        <p><strong>Message:</strong> ${request.message || 'No message'}</p>
      </div>
      <p>Sign in to your dashboard to accept or decline this request.</p>
    </div>
  `;

  return sendEmail({
    to: ownerEmail,
    subject: `New rent request — ${request.propertyName}`,
    html,
    text: `New rent request from ${request.fullName} (${guestPhone}) for ${request.propertyName}`,
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
        <p><strong>Guests:</strong> ${request.guests || 1}</p>
      </div>
      <p>Thank you for using MyGetawayRental.</p>
    </div>
  `;

  return sendEmail({
    to: guestEmail,
    subject: `We received your request — ${request.propertyName}`,
    html,
    text: `Your rental request for ${request.propertyName} was submitted.`,
  });
};

const sendGuestRequestAcceptedToGuest = async (guestEmail, request) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #22c55e;">Request accepted</h2>
      <p>Hi ${request.fullName},</p>
      <p>Good news — the owner accepted your rental request for <strong>${request.propertyName}</strong>.</p>
      <div style="background-color: #f0fdf4; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p><strong>Check-in:</strong> ${formatRequestDate(request.checkin)}</p>
        <p><strong>Check-out:</strong> ${formatRequestDate(request.checkout)}</p>
        <p><strong>Guests:</strong> ${request.guests || 1}</p>
      </div>
      <p>The owner may contact you directly to finalize details. If you have questions, reply to this email.</p>
    </div>
  `;

  return sendEmail({
    to: guestEmail,
    subject: `Confirmed — ${request.propertyName}`,
    html,
    text: `Your rental request for ${request.propertyName} was accepted by the owner.`,
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

// Send inquiry confirmation to guest 
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

// Send inquiry accepted notification to guest
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

// Send inquiry rejected notification to guest 
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
};
