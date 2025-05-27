// server.js
require('dotenv').config();

const fs         = require('fs');
const path       = require('path');
const express    = require('express');
const bodyParser = require('body-parser');
const Stripe     = require('stripe');
const sqlite3    = require('sqlite3').verbose();
const basicAuth  = require('express-basic-auth');
const { sendCodeByEmail } = require('./mailer');

// ————— Debug au démarrage —————
console.log('📂 CWD                   :', process.cwd());
console.log('🔍 .env présent ?         :', fs.existsSync(path.join(process.cwd(), '.env')));
console.log('🔑 STRIPE_SECRET_KEY     :', process.env.STRIPE_SECRET_KEY);
console.log('🔑 STRIPE_PUBLISHABLE_KEY:', process.env.STRIPE_PUBLISHABLE_KEY);
console.log('🔒 STRIPE_WEBHOOK_SECRET :', process.env.STRIPE_WEBHOOK_SECRET);

const app    = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const db     = new sqlite3.Database('./db.sqlite');

// Création de la table si nécessaire
db.serialize(() => {
    db.run(`
    CREATE TABLE IF NOT EXISTS purchases (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT,
      email       TEXT,
      phone       TEXT,
      code        TEXT UNIQUE,
      amount      INTEGER,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));

// 1) Enregistrement rapide depuis le front (workaround)
app.post('/save-purchase', bodyParser.json(), (req, res) => {
    console.log('📥  /save-purchase body:', req.body);
    const { name, email, phone, quantity } = req.body;
    const qty = parseInt(quantity, 10) || 1;
    const codes = [];
    const stmt = db.prepare(`
    INSERT INTO purchases (name, email, phone, code, amount)
    VALUES (?, ?, ?, ?, ?)
  `);

    for (let i = 0; i < qty; i++) {
        const code = generateCode(12);
        stmt.run(name, email, phone, code, 200, err => {
            if (err) console.error('❌ DB insert error (save-purchase):', err);
            else     console.log(`✅ save-purchase: ${email} with code ${code}`);
        });
        codes.push(code);
    }

    stmt.finalize(err => {
        if (err) {
            console.error('❌ DB finalize error:', err);
            return res.status(500).json({ error: err.message });
        }
        // envoi d'email pour chaque code (optionnel)
        codes.forEach(c => sendCodeByEmail(email, c).catch(console.error));
        res.json({ codes });
    });
});

// 2) Création du PaymentIntent Stripe
app.post('/create-payment', bodyParser.json(), async (req, res) => {
    console.log('📥  /create-payment body:', req.body);
    const { name, email, phone, quantity } = req.body;
    const qty = parseInt(quantity, 10) || 1;
    const amount = qty * 200; // 2€ = 200 centimes
    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency: 'eur',
            metadata: { name, email, phone, quantity: qty.toString() }
        });
        res.json({ clientSecret: paymentIntent.client_secret });
    } catch (err) {
        console.error('❌ Error create-payment:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3) Webhook Stripe (prod)
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), (req, res) => {
    console.log('📥  /webhook payload raw:', req.body.toString());
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('❌ Webhook signature error:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'payment_intent.succeeded') {
        const pi = event.data.object;
        const { name, email, phone, quantity } = pi.metadata;
        const qty = parseInt(quantity, 10) || 1;
        for (let i = 0; i < qty; i++) {
            const code = generateCode(12);
            db.run(
                `INSERT INTO purchases (name, email, phone, code, amount) VALUES (?, ?, ?, ?, ?)`,
                [name, email, phone, code, 200],
                err => {
                    if (err) console.error('❌ DB insert error (webhook):', err);
                    else     console.log(`✅ Purchase recorded for ${email} with code ${code}`);
                }
            );
            sendCodeByEmail(email, code).catch(console.error);
        }
    }

    res.json({ received: true });
});

// Page de remerciement
app.get('/thanks', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'thanks.html'));
});

// Authentification admin
app.use('/admin', basicAuth({
    users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASSWORD },
    challenge: true
}));

// Interface admin + API
app.get('/admin', (req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'admin.html'))
);
app.get('/admin/api/purchases', (req, res) =>
    db.all(
        `SELECT id, name, email, phone, code, amount, created_at FROM purchases`,
        [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    )
);

// Réinitialiser la base
app.post('/admin/reset', (req, res) => {
    db.run(`DELETE FROM purchases`, err => {
        if (err) {
            console.error('❌ DB reset error:', err);
            return res.status(500).json({ error: err.message });
        }
        console.log('🗑️  Base “purchases” vidée');
        res.json({ success: true });
    });
});

// Lancement du serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Serveur lancé sur le port ${PORT}`));

// Générateur de codes
function generateCode(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
