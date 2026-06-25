const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxhz6jrinc_UkNV7AT5vgMXFzydKtIqoEHajlTCCQE_sqokkWluVQ4jj946-ZyQnkawtg/exec';

async function sendTelegramMessage(chatId, text) {
  return fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  }).then(r => r.json());
}

app.post('/api/submit', async (req, res) => {
  const { name, username, message } = req.body;
  
  // 1. Уведомление админу
  const adminText = `🔥 Новая заявка!\nИмя: ${name}\nTelegram: ${username ? '@'+username : 'не указан'}\nСообщение: ${message}`;
  await sendTelegramMessage(TELEGRAM_CHAT_ID, adminText);

  // 2. Отправка в Google Таблицу
  try {
    await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, username, message })
    });
    console.log('Записано в таблицу');
  } catch (e) {
    console.error('Ошибка записи в таблицу:', e);
  }

  // 3. Попытка найти chat_id пользователя для автоответа
  // (Пока заглушка — доработаем после того, как добавим команду /start)
  if (username) {
    await sendTelegramMessage(TELEGRAM_CHAT_ID, `ℹ️ Пользователь @${username} ещё не писал боту. Напомни ему нажать /start.`);
  }

  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
