const nodemailer = require('nodemailer');

// Create transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Send email function
const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const info = await transporter.sendMail({
      from: process.env.FROM_EMAIL || process.env.SMTP_USER,
      to,
      subject,
      text,
      html,
    });
    console.log('Email sent:', info.messageId);
    return info;
  } catch (error) {
    console.error('Email error:', error);
    throw error;
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

// Send guest request notification to owner
const sendGuestRequestNotification = async (ownerEmail, request) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #10B981;">New Guest Request!</h2>
      <p>You have received a new contact request from a guest for your property.</p>
      <div style="background-color: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p><strong>Property:</strong> ${request.propertyName}</p>
        <p><strong>Guest Name:</strong> ${request.fullName}</p>
        <p><strong>Email:</strong> ${request.email}</p>
        <p><strong>Phone:</strong> ${request.phone || 'Not provided'}</p>
        <p><strong>Check-in:</strong> ${request.checkin ? new Date(request.checkin).toLocaleDateString() : 'Flexible'}</p>
        <p><strong>Check-out:</strong> ${request.checkout ? new Date(request.checkout).toLocaleDateString() : 'Flexible'}</p>
        <p><strong>Guests:</strong> ${request.guests || 1}</p>
        <p><strong>Message:</strong> ${request.message || 'No message'}</p>
      </div>
      <p>Log in to your dashboard to contact the guest and respond to this request.</p>
    </div>
  `;

  return sendEmail({
    to: ownerEmail,
    subject: `New Guest Request for ${request.propertyName} - MyGatewayRental`,
    html,
    text: `New guest request from ${request.fullName} for ${request.propertyName}`,
  });
};

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendInquiryNotification,
  sendGuestRequestNotification,
};
