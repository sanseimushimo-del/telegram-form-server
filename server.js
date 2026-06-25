const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwI6fxmpUdRoODrvEkpeAXeLNxqknfPIlpIjfytKDUYF0x8WPPt6LKGePM9OnXILtT-OA/exec';

const userChatIds = {};

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML'
  };
  if (replyMarkup) payload.reply_markup = JSON.stringify(replyMarkup);
  return fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(r => r.json());
}

async function editTelegramMessage(chatId, messageId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML'
  };
  if (replyMarkup) payload.reply_markup = JSON.stringify(replyMarkup);
  return fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(r => r.json());
}

// Вебхук Telegram
app.post('/telegram-webhook', async (req, res) => {
  try {
    const update = req.body;
    if (update.message && update.message.text === '/start') {
      const chatId = update.message.chat.id;
      const username = update.message.from.username;
      if (username) {
        userChatIds[username] = chatId;
        await sendTelegramMessage(chatId, '👋 Привет! Теперь, когда ты отправишь заявку, я сразу пришлю тебе подтверждение.');
      } else {
        await sendTelegramMessage(chatId, 'Установи username в настройках Telegram, чтобы получать автоответы.');
      }
    }
    if (update.callback_query) {
      const query = update.callback_query;
      const data = query.data;
      const msg = query.message;
      const chatId = msg.chat.id;
      const messageId = msg.message_id;
      let newText = msg.text;
      let newMarkup = msg.reply_markup;
      if (data.startsWith('reply_')) {
        newText += '\n\n✅ <b>Действие:</b> Ответить';
        newMarkup = null;
      } else if (data.startsWith('take_')) {
        newText += '\n\n✅ <b>Статус:</b> Взято в работу';
        newMarkup = null;
      } else if (data.startsWith('close_')) {
        newText += '\n\n❌ <b>Статус:</b> Закрыто';
        newMarkup = null;
      }
      await editTelegramMessage(chatId, messageId, newText, newMarkup);
      return res.json({ callback_query_id: query.id });
    }
    res.send('ok');
  } catch (e) {
    console.error('Webhook error:', e);
    res.sendStatus(500);
  }
});

// Приём заявки
app.post('/api/submit', async (req, res) => {
  const { name, username, message } = req.body;

  const adminText = `🔥 <b>Новая заявка!</b>\nИмя: ${name}\nTelegram: ${username ? '@'+username : 'не указан'}\nСообщение: ${message}`;
  const inlineKeyboard = {
    inline_keyboard: [
      [{ text: '✉️ Ответить', callback_data: `reply_${username}` }],
      [{ text: '✅ Взять в работу', callback_data: `take_${username}` }],
      [{ text: '❌ Закрыть', callback_data: `close_${username}` }]
    ]
  };
  await sendTelegramMessage(TELEGRAM_CHAT_ID, adminText, inlineKeyboard);

  // Запись в таблицу и отправка email (всё внутри Google Script)
  try {
    await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, username, message })
    });
  } catch (e) {
    console.error('Google Script error:', e);
  }

  // Автоответ пользователю
  if (username && userChatIds[username]) {
    await sendTelegramMessage(userChatIds[username], `👋 <b>Спасибо, ${name}!</b>\nМы получили твою заявку и скоро свяжемся с тобой.`);
  } else if (username) {
    await sendTelegramMessage(TELEGRAM_CHAT_ID, `ℹ️ Пользователь @${username} ещё не написал боту /start. Напомни ему активировать бота.`);
  }

  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
