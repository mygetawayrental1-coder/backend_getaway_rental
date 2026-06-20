const axios = require('axios');

async function testInquiry() {
    try {
        console.log("1. Creating captcha...");
        const captchaRes = await axios.get('http://localhost:5000/captcha/create-captcha');
        const { id, imageBase64 } = captchaRes.data;
        console.log("Captcha ID:", id);

        // We can't easily "solve" the captcha here unless we log it in the console on the server
        // But let's try to send a request and see if we get "Invalid captcha" (400) or something else.

        console.log("2. Submitting inquiry with incorrect captcha to triggered controlled failure...");
        const inquiryRes = await axios.post('http://localhost:5000/inquiries/create', {
            propertyId: 'prop-001',
            fullName: 'Test User',
            email: 'test@example.com',
            phone: '1234567890',
            gender: 'Male',
            guests: 2,
            message: 'Hello',
            checkin: '2024-03-20',
            checkout: '2024-03-23',
            captchaId: id,
            captchaCode: 'WRONG'
        });
        console.log("Success:", inquiryRes.data);
    } catch (error) {
        if (error.response) {
            console.log("Error Status:", error.response.status);
            console.log("Error Data:", JSON.stringify(error.response.data));
        } else {
            console.log("Error:", error.message);
        }
    }
}

testInquiry();
