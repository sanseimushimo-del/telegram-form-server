const express = require('express');
const app = express();
app.use(express.json());
const cors = require('cors');
app.use(cors());

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

app.post('/api/submit', async (req, res) => {
    const { name, message } = req.body;
    const text = `🔥 Новая заявка!\nИмя: ${name}\nСообщение: ${message}`;
    
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: text
            })
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: true });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`)); 
