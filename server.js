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

// Подключение к FreeDB
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

// Инициализация Resend
const resend = new Resend('re_hf1C5AM3_NcBtCApSVzJ8Y9ioUdm4LJxu');

const sendResetEmail = async (userEmail, resetToken) => {
  try {
    console.log(`📧 Попытка отправки через Resend API...`);
    
    const { data, error } = await resend.emails.send({
      from: 'EcoTracker <onboarding@resend.dev>',
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
      `
    });

    if (error) {
      console.log(`❌ Resend не сработал:`, error.message);
      throw error;
    }

    console.log(`✅ Email отправлен через Resend! ID:`, data.id);
    
    return { 
      success: true, 
      provider: 'Resend',
      emailId: data.id
    };
      
  } catch (error) {
    console.log(`❌ Resend не сработал:`, error.message);
    
    // Если не сработало - возвращаем токен
    console.log('🔐 Email не отправлен, возвращаем токен');
    return { 
      success: false, 
      error: 'Используйте этот код для сброса пароля: ' + resetToken,
      token: resetToken
    };
  }
};

// Остальной код без изменений...
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-2024';

// Middleware для проверки JWT токена
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Токен доступа отсутствует' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Неверный токен' });
    }
    req.user = user;
    next();
  });
};

// Главная страница
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
      'GET /api/profile': 'Получить профиль',
      'POST /api/test-email': 'Тест отправки email'
    }
  });
});

// Тестовый endpoint для проверки Resend
app.post('/api/test-email', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ 
      success: false, 
      error: 'Email обязателен' 
    });
  }

  const testToken = 'TEST-' + Math.random().toString(36).substr(2, 8).toUpperCase();
  const result = await sendResetEmail(email, testToken);
  
  res.json({
    success: result.success,
    message: result.success ? 
      `✅ Тестовый email отправлен через Resend!` : 
      '❌ Email не отправлен, используйте токен:',
    token: result.token,
    provider: result.provider,
    emailId: result.emailId
  });
});

// Регистрация пользователя
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  
  console.log('📨 Получен запрос на регистрацию:', { username, email });
  
  if (!username || !email || !password) {
    return res.status(400).json({ 
      success: false, 
      error: 'Все поля обязательны для заполнения' 
    });
  }

  if (password.length < 6) {
    return res.status(400).json({ 
      success: false, 
      error: 'Пароль должен содержать минимум 6 символов' 
    });
  }

  try {
    const checkUserQuery = 'SELECT * FROM users WHERE username = ? OR email = ?';
    db.query(checkUserQuery, [username, email], async (err, results) => {
      if (err) {
        console.error('❌ Database error:', err.message);
        return res.status(500).json({ 
          success: false, 
          error: 'Ошибка базы данных' 
        });
      }
      
      if (results.length > 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'Пользователь с таким email или именем уже существует' 
        });
      }
      
      const passwordHash = await bcrypt.hash(password, 10);
      const insertUserQuery = 'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)';
      
      db.query(insertUserQuery, [username, email, passwordHash], (err, results) => {
        if (err) {
          console.error('❌ Insert error:', err.message);
          return res.status(500).json({ 
            success: false, 
            error: 'Ошибка при создании пользователя' 
          });
        }
        
        const token = jwt.sign(
          { userId: results.insertId, username: username }, 
          JWT_SECRET,
          { expiresIn: '30d' }
        );
        
        console.log('✅ Пользователь зарегистрирован:', username);
        
        res.json({ 
          success: true, 
          message: 'Регистрация успешна',
          token,
          user: {
            id: results.insertId,
            username: username,
            email: email
          }
        });
      });
    });
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

// Вход пользователя
app.post('/api/login', async (req, res) => {
  const { usernameOrEmail, password } = req.body;
  
  console.log('📨 Получен запрос на вход:', { usernameOrEmail });
  
  if (!usernameOrEmail || !password) {
    return res.status(400).json({ 
      success: false, 
      error: 'Все поля обязательны для заполнения' 
    });
  }

  try {
    const findUserQuery = 'SELECT * FROM users WHERE username = ? OR email = ?';
    db.query(findUserQuery, [usernameOrEmail, usernameOrEmail], async (err, results) => {
      if (err) {
        console.error('❌ Database error:', err.message);
        return res.status(500).json({ 
          success: false, 
          error: 'Ошибка базы данных' 
        });
      }
      
      if (results.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'Пользователь не найден' 
        });
      }
      
      const user = results[0];
      const validPassword = await bcrypt.compare(password, user.password_hash);
      
      if (!validPassword) {
        return res.status(400).json({ 
          success: false, 
          error: 'Неверный пароль' 
        });
      }
      
      const token = jwt.sign(
        { userId: user.id, username: user.username }, 
        JWT_SECRET,
        { expiresIn: '30d' }
      );
      
      console.log('✅ Пользователь вошел:', user.username);
      
      res.json({ 
        success: true, 
        message: 'Вход успешен',
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email
        }
      });
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

// Запрос сброса пароля
app.post('/api/reset-password-request', async (req, res) => {
  const { email } = req.body;
  
  console.log('📧 Запрос сброса пароля для email:', email);
  
  if (!email) {
    return res.status(400).json({ 
      success: false, 
      error: 'Email обязателен' 
    });
  }

  try {
    const findUserQuery = 'SELECT * FROM users WHERE email = ?';
    db.query(findUserQuery, [email], async (err, results) => {
      if (err) {
        console.error('❌ Database error:', err.message);
        return res.status(500).json({ 
          success: false, 
          error: 'Ошибка базы данных' 
        });
      }
      
      if (results.length === 0) {
        console.log('📧 Email не найден, но отправляем успешный ответ для безопасности');
        return res.json({ 
          success: true, 
          message: 'Если email существует, инструкции отправлены' 
        });
      }
      
      const user = results[0];
      const resetToken = crypto.randomBytes(32).toString('hex');
      const tokenExpires = new Date(Date.now() + 3600000);
      
      const updateTokenQuery = 'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?';
      db.query(updateTokenQuery, [resetToken, tokenExpires, user.id], async (err, result) => {
        if (err) {
          console.error('❌ Token update error:', err.message);
          return res.status(500).json({ 
            success: false, 
            error: 'Ошибка при создании токена' 
          });
        }
        
        console.log('✅ Токен сброса пароля создан для:', email);
        
        const emailResult = await sendResetEmail(email, resetToken);
        
        if (emailResult.success) {
          res.json({ 
            success: true, 
            message: `Инструкции по сбросу пароля отправлены на ваш email (через ${emailResult.provider})`
          });
        } else {
          res.json({ 
            success: true, 
            message: emailResult.error,
            reset_token: resetToken
          });
        }
      });
    });
  } catch (error) {
    console.error('❌ Reset password request error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

// Сброс пароля с токеном
app.post('/api/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  
  console.log('🔄 Запрос установки нового пароля');
  
  if (!token || !newPassword) {
    return res.status(400).json({ 
      success: false, 
      error: 'Токен и новый пароль обязательны' 
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ 
      success: false, 
      error: 'Пароль должен содержать минимум 6 символов' 
    });
  }

  try {
    const findUserQuery = 'SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > NOW()';
    db.query(findUserQuery, [token], async (err, results) => {
      if (err) {
        console.error('❌ Database error:', err.message);
        return res.status(500).json({ 
          success: false, 
          error: 'Ошибка базы данных' 
        });
      }
      
      if (results.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'Неверный или просроченный токен' 
        });
      }
      
      const user = results[0];
      const passwordHash = await bcrypt.hash(newPassword, 10);
      
      const updatePasswordQuery = 'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?';
      db.query(updatePasswordQuery, [passwordHash, user.id], (err, result) => {
        if (err) {
          console.error('❌ Password update error:', err.message);
          return res.status(500).json({ 
            success: false, 
            error: 'Ошибка при обновлении пароля' 
          });
        }
        
        console.log('✅ Пароль обновлен для пользователя:', user.email);
        
        res.json({ 
          success: true, 
          message: 'Пароль успешно изменен' 
        });
      });
    });
  } catch (error) {
    console.error('❌ Reset password error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

// Остальные endpoints...
app.get('/api/sensor-data', authenticateToken, (req, res) => {
  const query = 'SELECT * FROM sensor_data ORDER BY created_at DESC LIMIT 1';
  
  db.query(query, (err, results) => {
    if (err) {
      console.error('❌ Database error:', err.message);
      res.status(500).json({ 
        success: false, 
        error: err.message 
      });
    } else {
      console.log('✅ Data retrieved for user:', req.user.username);
      res.json({
        success: true,
        data: results[0] || {}
      });
    }
  });
});

// Проверка здоровья API
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    message: 'API работает нормально',
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('🚀 Sensor API с аутентификацией запущен на порту ' + PORT);
  console.log('🔐 JWT Secret:', JWT_SECRET ? 'Установлен' : 'Используется дефолтный');
  console.log('📧 Email service: Resend API настроен');
});
