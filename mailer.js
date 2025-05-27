// mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT, 10),
    secure: false, // true si port 465
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

async function sendCodeByEmail(to, code) {
    await transporter.sendMail({
        from: `"Post-It Digital" <${process.env.EMAIL_USER}>`,
        to,
        subject: "Votre Post-it digital et votre code unique",
        text: `Merci pour votre achat !\n\nVotre code unique : ${code}\n\nÀ bientôt !`
    });
    console.log("📧 Email envoyé à", to);
}

module.exports = { sendCodeByEmail };
