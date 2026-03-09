require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('./src/config/database');
const { generateToken } = require('./src/services/token.service');
const { sendVerificationEmail } = require('./src/services/email.service');

async function doSignup() {
    try {
        const email = "sarwarmohd470@gmail.com";
        const password = "Password123!";

        // Clean up previous test
        await prisma.user.deleteMany({
            where: { email }
        });

        console.log("Deleted existing test user.");

        const hashedPassword = await bcrypt.hash(password, 12);
        const verifyToken = generateToken({ email }, '24h');

        console.log("Creating new user...");
        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                firstName: "Mohd",
                lastName: "Kabir",
                countryCode: "+91",
                phoneNumber: "9999999999",
                address: "Test Address",
                role: "OWNER",
                verifyToken
            }
        });

        console.log("User successfully created in DB:", user.email);

        console.log("Triggering Brevo verification email equivalent to API /auth/register...");
        await sendVerificationEmail(email, verifyToken);

        console.log("Registration complete! Email successfully sent to Brevo Relay.");
        process.exit(0);
    } catch (e) {
        console.error("Signup failed:", e);
        process.exit(1);
    }
}

doSignup();
