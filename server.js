const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, error: 'Слишком много запросов. Попробуйте позже.' }
});
app.use('/api/submit', limiter);

const TELEGRAM_BOT_TOKEN = '8667715912:AAHgHzSwHRafoJkvRuUssryygOjD1E0y3h8';
const TELEGRAM_CHAT_ID = '453801455';
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyPqvAG0XbwTGjjrXB1PJ8KoMMx8XMEkk2_PRPO0gPK8Zjt9FMmRc72zjNIJ2OjXapi8w/exec';
const ADMIN_EMAIL = 'sanseimushimo@gmail.com';

const userChatIds = {};
const pendingWarnings = {};
const lastRequests = {};
const ticketMessages = {};

// === Telegram helpers ===
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

async function updateStatusInSheet(username, timestamp, status, comment = '') {
  try {
    await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateStatus', username, timestamp, status, comment })
    });
  } catch (e) {
    console.error('Update status error:', e);
  }
}

// === Webhook ===
app.post('/telegram-webhook', async (req, res) => {
  try {
    const update = req.body;

    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const text = msg.text || '';
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
      } else if (chatId.toString() === TELEGRAM_CHAT_ID) {
        if (text === '/stats') {
          const res = await fetch(GOOGLE_SCRIPT_URL + '?action=read');
          const data = await res.json();
          const total = data.length - 1;
          const today = new Date().toLocaleDateString();
          const todayCount = data.slice(1).filter(row => {
            const rowDate = new Date(row[0]).toLocaleDateString();
            return rowDate === today;
          }).length;
          await sendTelegramMessage(chatId, `📊 <b>Статистика</b>\nВсего заявок: ${total}\nСегодня: ${todayCount}`);
        } else if (text === '/report') {
          const res = await fetch(GOOGLE_SCRIPT_URL + '?action=report');
          const data = await res.json();
          const csv = data.map(row => row.map(cell => `"${(cell+'').replace(/"/g, '""')}"`).join(',')).join('\n');
          const buf = Buffer.from(csv, 'utf-8');
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              document: { value: buf.toString('base64'), filename: 'zayavki.csv' },
              caption: '📋 Все заявки'
            })
          });
        } else if (text.startsWith('/reply')) {
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
              await sendTelegramMessage(chatId, `❌ Пользователь @${targetUsername} ещё не активировал бота.`);
            }
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
      const [action, targetUsername] = data.split('_');
      let newText = msg.text;
      let newMarkup = msg.reply_markup;

      if (action === 'reply') {
        newText += '\n\n✅ <b>Действие:</b> Ответить';
        newMarkup = null;
      } else if (action === 'take') {
        newText += '\n\n✅ <b>Статус:</b> Взято в работу';
        newMarkup = null;
        // Уведомить пользователя
        if (userChatIds[targetUsername]) {
          await sendTelegramMessage(userChatIds[targetUsername], '🔔 Ваша заявка взята в работу. Ожидайте ответа.');
        }
        // Обновить статус в таблице
        const ticket = ticketMessages[targetUsername];
        if (ticket) {
          await updateStatusInSheet(targetUsername, ticket.timestamp, 'В работе');
        }
      } else if (action === 'close') {
        newText += '\n\n❌ <b>Статус:</b> Закрыто';
        newMarkup = { inline_keyboard: [[{ text: '⭐ Оценить обслуживание', callback_data: `rate_${targetUsername}` }]] };
        if (userChatIds[targetUsername]) {
          await sendTelegramMessage(userChatIds[targetUsername], '✅ Ваша заявка закрыта. Пожалуйста, оцените обслуживание.');
        }
        const ticket = ticketMessages[targetUsername];
        if (ticket) {
          await updateStatusInSheet(targetUsername, ticket.timestamp, 'Закрыто');
        }
      } else if (action === 'rate') {
        // Обработка оценки
        const rating = parseInt(targetUsername) || 5; // упрощённо – можно сделать кнопки 1-5
        newText += `\n\n⭐ Оценка: ${rating}`;
        newMarkup = null;
        await sendTelegramMessage(chatId, `Спасибо за оценку! Ваша заявка оценена на ${rating}.`);
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

// === Приём заявки ===
app.post('/api/submit', async (req, res) => {
  const { name, phone, username, topic, message } = req.body;

  // Сохраняем timestamp для обновления статуса
  const timestamp = new Date().toISOString();

  if (username) {
    lastRequests[username] = { name, message };
    ticketMessages[username] = { timestamp, adminMessageId: null };
  }

  const adminText = `🔥 <b>Новая заявка!</b>\nИмя: ${name}\nТелефон: ${phone}\nTelegram: ${username ? '@'+username : 'не указан'}\nТема: ${topic}\nСообщение: ${message}`;
  const inlineKeyboard = {
    inline_keyboard: [
      [{ text: '✉️ Ответить', callback_data: `reply_${username}` }],
      [{ text: '✅ Взять в работу', callback_data: `take_${username}` }],
      [{ text: '❌ Закрыть', callback_data: `close_${username}` }]
    ]
  };

  const sentMsg = await sendTelegramMessage(TELEGRAM_CHAT_ID, adminText, inlineKeyboard);
  if (username && ticketMessages[username]) {
    ticketMessages[username].adminMessageId = sentMsg.result?.message_id;
  }

  // Отправка в Google Script (email + таблица)
  try {
    await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, username, topic, message })
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
