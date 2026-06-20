// Using native fetch and FormData

async function testSignup() {
    try {
        // Step 1: Create a valid Captcha
        const captchaRes = await fetch('http://localhost:5000/captcha/create-captcha');
        const captchaData = await captchaRes.json();
        const captchaId = captchaData.id;

        console.log("Got captcha ID:", captchaId);

        // Wait... the text returned by generate SVG is not in the json directly.
        // Let's just read the DB directly using Prisma and the captcha logic or do a small hack 
        // Oh wait, `generateSVG` creates an SVG. The text is NOT returned in the JSON!

        // To bypass captcha logic purely for seeing the OTHER 400 errors, 
        // I will temporarily make a mock captcha manually inserted into the Map!
        // Actually, since I am hitting the API, I can't easily insert into the Map directly from another node process.

    } catch (e) {
        console.error(e);
    }
}
testSignup();
