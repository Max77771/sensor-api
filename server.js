const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Resend } = require('resend');

const app = express();
app.use(cors());
app.use(express.json());

// ===============================
// 🔐 Конфигурация базы данных
// ===============================
const db = mysql.createConnection({
  host: "sql.freedb.tech",
  user: "freedb_sensor_user",
  password: "53dddC!A&VVuFjB",
  database: "freedb_sensor_data",
  port: 3306
});

db.connect((err) => {
  if (err) {
    console.error('❌ Ошибка подключения к MySQL:', err.message);
  } else {
    console.log('✅ Успешно подключено к FreeDB MySQL');
  }
});

// ===============================
// ✉️ Отправка писем через Resend
// ===============================
const resend = new Resend(process.env.RESEND_API_KEY);

const sendResetEmail = async (userEmail, resetToken) => {
  try {
    console.log(`📧 Отправка письма через Resend...`);

    const { error } = await resend.emails.send({
      from: 'EcoTracker <noreply@resend.dev>',
      to: userEmail,
      subject: 'Сброс пароля - EcoTracker',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #4CAF50; text-align: center;">Сброс пароля</h2>
          <p>Здравствуйте!</p>
          <p>Вы запросили сброс пароля для вашего аккаунта в приложении <strong>EcoTracker</strong>.</p>
          <p>Для сброса пароля используйте следующий код:</p>
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; font-size: 20px; font-weight: bold; letter-spacing: 3px; margin: 25px 0; font-family: 'Courier New', monospace; border: 2px dashed #4CAF50;">
            ${resetToken}
          </div>
          <p style="color: #666; font-size: 14px; text-align: center;">
            <strong>Внимание:</strong> Этот код действителен в течение 1 часа.
          </p>
          <p>Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.</p>
          <br>
          <p>С уважением,<br><strong>Команда EcoTracker</strong></p>
        </div>
      `,
    });

    if (error) {
      console.error('❌ Ошибка Resend:', error);
      return { success: false, error: error.message, token: resetToken };
    }

    console.log('✅ Email успешно отправлен через Resend!');
    return { success: true, provider: 'Resend' };

  } catch (err) {
    console.error('❌ Ошибка при работе с Resend:', err.message);
    return { success: false, error: 'Ошибка при отправке письма', token: resetToken };
  }
};

// ===============================
// 🔐 JWT и Middleware
// ===============================
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-2024';

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'Токен доступа отсутствует' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, error: 'Неверный токен' });
    req.user = user;
    next();
  });
};

// ===============================
// 🌍 Основные маршруты API
// ===============================
app.get('/', (req, res) => {
  res.json({
    message: '🚀 Sensor API работает!',
    endpoints: {
      'POST /api/register': 'Регистрация пользователя',
      'POST /api/login': 'Вход пользователя',
      'POST /api/reset-password-request': 'Запрос сброса пароля',
      'POST /api/reset-password': 'Сброс пароля с токеном',
      'GET /api/sensor-data': 'Получить последние данные',
      'POST /api/sensor-data': 'Отправить данные с Arduino',
      'GET /api/profile': 'Получить профиль'
    }
  });
});

// ===============================
// 👤 Регистрация
// ===============================
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ success: false, error: 'Все поля обязательны' });

  if (password.length < 6)
    return res.status(400).json({ success: false, error: 'Пароль должен быть минимум 6 символов' });

  try {
    const checkUserQuery = 'SELECT * FROM users WHERE username = ? OR email = ?';
    db.query(checkUserQuery, [username, email], async (err, results) => {
      if (err) return res.status(500).json({ success: false, error: 'Ошибка базы данных' });
      if (results.length > 0)
        return res.status(400).json({ success: false, error: 'Пользователь уже существует' });

      const passwordHash = await bcrypt.hash(password, 10);
      const insertUserQuery = 'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)';
      db.query(insertUserQuery, [username, email, passwordHash], (err, results) => {
        if (err) return res.status(500).json({ success: false, error: 'Ошибка при создании пользователя' });

        const token = jwt.sign({ userId: results.insertId, username }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ success: true, message: 'Регистрация успешна', token });
      });
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// ===============================
// 🔑 Вход
// ===============================
app.post('/api/login', async (req, res) => {
  const { usernameOrEmail, password } = req.body;
  if (!usernameOrEmail || !password)
    return res.status(400).json({ success: false, error: 'Все поля обязательны' });

  const query = 'SELECT * FROM users WHERE username = ? OR email = ?';
  db.query(query, [usernameOrEmail, usernameOrEmail], async (err, results) => {
    if (err) return res.status(500).json({ success: false, error: 'Ошибка базы данных' });
    if (results.length === 0) return res.status(400).json({ success: false, error: 'Пользователь не найден' });

    const user = results[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(400).json({ success: false, error: 'Неверный пароль' });

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, message: 'Вход успешен', token });
  });
});

// ===============================
// 🔄 Запрос сброса пароля
// ===============================
app.post('/api/reset-password-request', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'Email обязателен' });

  const query = 'SELECT * FROM users WHERE email = ?';
  db.query(query, [email], async (err, results) => {
    if (err) return res.status(500).json({ success: false, error: 'Ошибка базы данных' });

    if (results.length === 0)
      return res.json({ success: true, message: 'Если email существует, инструкции отправлены' });

    const user = results[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000);
    db.query('UPDATE users SET reset_token=?, reset_token_expires=? WHERE id=?',
      [resetToken, expires, user.id], async (err) => {
        if (err) return res.status(500).json({ success: false, error: 'Ошибка при создании токена' });
        const emailResult = await sendResetEmail(email, resetToken);
        res.json({
          success: true,
          message: emailResult.success
            ? 'Инструкции отправлены на почту'
            : emailResult.error,
          reset_token: emailResult.token || null
        });
      });
  });
});

// ===============================
// 🆕 Сброс пароля
// ===============================
app.post('/api/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword)
    return res.status(400).json({ success: false, error: 'Токен и пароль обязательны' });

  const query = 'SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > NOW()';
  db.query(query, [token], async (err, results) => {
    if (err) return res.status(500).json({ success: false, error: 'Ошибка базы данных' });
    if (results.length === 0)
      return res.status(400).json({ success: false, error: 'Неверный или просроченный токен' });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    db.query('UPDATE users SET password_hash=?, reset_token=NULL, reset_token_expires=NULL WHERE id=?',
      [passwordHash, results[0].id], (err) => {
        if (err) return res.status(500).json({ success: false, error: 'Ошибка обновления пароля' });
        res.json({ success: true, message: 'Пароль успешно изменен' });
      });
  });
});

// ===============================
// 📡 Данные сенсора
// ===============================
app.get('/api/sensor-data', authenticateToken, (req, res) => {
  const query = 'SELECT * FROM sensor_data ORDER BY created_at DESC LIMIT 1';
  db.query(query, (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, data: results[0] || {} });
  });
});

// ===============================
// ❤️ Проверка здоровья
// ===============================
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'API работает нормально', timestamp: new Date().toISOString() });
});

// ===============================
// 🚀 Запуск сервера
// ===============================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('🚀 Sensor API с аутентификацией запущен на порту ' + PORT);
  console.log('📧 Email service: Resend активен');
});
