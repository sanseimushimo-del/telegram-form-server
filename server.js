const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwI6fxmpUdRoODrvEkpeAXeLNxqknfPIlpIjfytKDUYF0x8WPPt6LKGePM9OnXILtT-OA/exec';

const userChatIds = {};
const pendingWarnings = {};
const lastRequests = {};

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) payload.reply_markup = JSON.stringify(replyMarkup);
  return fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  }).then(r => r.json());
}

async function editTelegramMessage(chatId, messageId, text, replyMarkup = null) {
  const payload = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
  if (replyMarkup) payload.reply_markup = JSON.stringify(replyMarkup);
  return fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  }).then(r => r.json());
}

async function deleteTelegramMessage(chatId, messageId) {
  return fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, message_id: messageId })
  }).then(r => r.json());
}

app.post('/telegram-webhook', async (req, res) => {
  try {
    const update = req.body;
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const text = msg.text;
      const username = msg.from.username;
      if (text === '/start') {
        if (username) {
          userChatIds[username] = chatId;
          if (lastRequests[username]) {
            const reqData = lastRequests[username];
            await sendTelegramMessage(chatId, `👋 <b>Спасибо, ${reqData.name}!</b>\nМы получили твою заявку и скоро свяжемся с тобой.`);
            delete lastRequests[username];
          } else {
            await sendTelegramMessage(chatId, '👋 Привет! Теперь, когда ты отправишь заявку, я сразу пришлю тебе подтверждение.');
          }
        } else {
          await sendTelegramMessage(chatId, 'Установи username в настройках Telegram, чтобы получать автоответы.');
        }
      } else if (chatId.toString() === TELEGRAM_CHAT_ID && text.startsWith('/reply')) {
        const parts = text.split(' ');
        if (parts.length < 3) {
          await sendTelegramMessage(chatId, 'Используй: /reply @username текст');
        } else {
          const targetUsername = parts[1].replace('@', '');
          const replyText = parts.slice(2).join(' ');
          if (userChatIds[targetUsername]) {
            await sendTelegramMessage(userChatIds[targetUsername], `📩 Сообщение от поддержки:\n${replyText}`);
            await sendTelegramMessage(chatId, `✅ Сообщение отправлено @${targetUsername}`);
          } else {
            await sendTelegramMessage(chatId, `❌ Пользователь @${targetUsername} ещё не активировал бота. Попроси его написать /start.`);
          }
        }
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
      const action = data.split('_')[0];
      const targetUsername = data.substring(data.indexOf('_') + 1);
      if (action === 'reply') {
        newText += '\n\n✅ <b>Действие:</b> Ответить';
        newMarkup = null;
      } else if (action === 'take') {
        newText += '\n\n✅ <b>Статус:</b> Взято в работу';
        newMarkup = null;
      } else if (action === 'close') {
        newText += '\n\n❌ <b>Статус:</b> Закрыто';
        newMarkup = null;
      }
      await editTelegramMessage(chatId, messageId, newText, newMarkup);
      if (pendingWarnings[targetUsername]) {
        await deleteTelegramMessage(chatId, pendingWarnings[targetUsername]);
        delete pendingWarnings[targetUsername];
      }
      return res.json({ callback_query_id: query.id });
    }
    res.send('ok');
  } catch (e) {
    console.error('Webhook error:', e);
    res.sendStatus(500);
  }
});

app.post('/api/submit', async (req, res) => {
  const { name, username, message } = req.body;
  if (username) {
    lastRequests[username] = { name, message };
  }
  const adminText = `🔥 <b>Новая заявка!</b>\nИмя: ${name}\nTelegram: ${username ? '@'+username : 'не указан'}\nСообщение: ${message}`;
  const inlineKeyboard = {
    inline_keyboard: [
      [{ text: '✉️ Ответить', callback_data: `reply_${username}` }],
      [{ text: '✅ Взять в работу', callback_data: `take_${username}` }],
      [{ text: '❌ Закрыть', callback_data: `close_${username}` }]
    ]
  };
  await sendTelegramMessage(TELEGRAM_CHAT_ID, adminText, inlineKeyboard);
  try {
    await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, username, message })
    });
  } catch (e) {
    console.error('Google Script error:', e);
  }
  if (username && userChatIds[username]) {
    await sendTelegramMessage(userChatIds[username], `👋 <b>Спасибо, ${name}!</b>\nМы получили твою заявку и скоро свяжемся с тобой.`);
  } else if (username) {
    const warning = await sendTelegramMessage(TELEGRAM_CHAT_ID, `ℹ️ Пользователь @${username} ещё не написал боту /start. Напомни ему активировать бота.`);
    if (warning.ok) {
      pendingWarnings[username] = warning.result.message_id;
    }
  }
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
