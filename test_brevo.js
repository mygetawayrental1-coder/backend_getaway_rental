require('dotenv').config();
const { sendVerificationEmail } = require('./src/services/email.service');

async function testEmail() {
    try {
        console.log("Sending test email to mohdkabirmd@gmail.com...");
        const response = await sendVerificationEmail("mohdkabirmd@gmail.com", "TEST-TOKEN-12345");
        console.log("Email Sent Successfully!", response);
        process.exit(0);
    } catch (e) {
        console.error("Test execution failed:", e);
        process.exit(1);
    }
}

testEmail();
