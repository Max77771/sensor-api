const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

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

// Проверка подключения
db.connect((err) => {
  if (err) {
    console.error('❌ Ошибка подключения к MySQL:', err.message);
  } else {
    console.log('✅ Успешно подключено к FreeDB MySQL');
    
    // Проверяем существование колонок reset_token
    db.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = 'freedb_sensor_data' 
      AND TABLE_NAME = 'users' 
      AND COLUMN_NAME IN ('reset_token', 'reset_token_expires')
    `, (err, results) => {
      if (err) {
        console.error('❌ Ошибка проверки структуры таблицы:', err.message);
      } else {
        const existingColumns = results.map(row => row.COLUMN_NAME);
        console.log('📊 Существующие колонки для сброса пароля:', existingColumns);
        
        if (!existingColumns.includes('reset_token')) {
          console.log('⚠️ Колонка reset_token отсутствует. Нужно выполнить ALTER TABLE');
        }
        if (!existingColumns.includes('reset_token_expires')) {
          console.log('⚠️ Колонка reset_token_expires отсутствует. Нужно выполнить ALTER TABLE');
        }
      }
    });
  }
});

// JWT секрет
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-2024';

// Middleware для проверки JWT токена
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

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
      'GET /api/sensor-data': 'Получить последние данные (требует авторизацию)',
      'POST /api/sensor-data': 'Отправить данные с Arduino (требует авторизацию)',
      'GET /api/profile': 'Получить профиль (требует авторизацию)'
    }
  });
});

// Регистрация пользователя
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  
  console.log('📨 Получен запрос на регистрацию:', { username, email });
  
  // Валидация
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
    // Проверяем существование пользователя
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
      
      // Хешируем пароль
      const passwordHash = await bcrypt.hash(password, 10);
      
      // Сохраняем пользователя
      const insertUserQuery = 'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)';
      db.query(insertUserQuery, [username, email, passwordHash], (err, results) => {
        if (err) {
          console.error('❌ Insert error:', err.message);
          return res.status(500).json({ 
            success: false, 
            error: 'Ошибка при создании пользователя' 
          });
        }
        
        // Создаем JWT токен
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
    // Ищем пользователя
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
      
      // Проверяем пароль
      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        return res.status(400).json({ 
          success: false, 
          error: 'Неверный пароль' 
        });
      }
      
      // Создаем JWT токен
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
    // Ищем пользователя по email
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
        // Для безопасности не сообщаем, что email не найден
        console.log('📧 Email не найден, но отправляем успешный ответ для безопасности');
        return res.json({ 
          success: true, 
          message: 'Если email существует, инструкции отправлены' 
        });
      }
      
      const user = results[0];
      
      // Генерируем токен сброса пароля
      const resetToken = crypto.randomBytes(32).toString('hex');
      const tokenExpires = new Date(Date.now() + 3600000); // 1 час
      
      // Сохраняем токен в базе данных
      const updateTokenQuery = 'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?';
      db.query(updateTokenQuery, [resetToken, tokenExpires, user.id], async (err, result) => {
        if (err) {
          console.error('❌ Token update error:', err.message);
          
          // Проверяем, если ошибка из-за отсутствующих колонок
          if (err.message.includes('reset_token')) {
            return res.status(500).json({ 
              success: false, 
              error: 'Система сброса пароля временно недоступна. Пожалуйста, обратитесь к администратору.' 
            });
          }
          
          return res.status(500).json({ 
            success: false, 
            error: 'Ошибка при создании токена' 
          });
        }
        
        console.log('✅ Токен сброса пароля создан для:', email);
        console.log('🔑 Токен (для тестирования):', resetToken);
        
        // В реальном приложении здесь должна быть отправка email
        // Для демонстрации просто возвращаем успех
        res.json({ 
          success: true, 
          message: 'Инструкции по сбросу пароля отправлены на email'
        });
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
    // Ищем пользователя по токену и проверяем срок действия
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
      
      // Хешируем новый пароль
      const passwordHash = await bcrypt.hash(newPassword, 10);
      
      // Обновляем пароль и очищаем токен
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

// Получение последних данных (требует авторизацию)
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

// Отправка данных с Arduino (требует авторизацию)
app.post('/api/sensor-data', authenticateToken, (req, res) => {
  const { latitude, longitude, temperature, humidity, pressureHPa, pressureMmHg, altitude, timestamp } = req.body;
  
  console.log('📨 Получены данные с Arduino от пользователя:', req.user.username);
  console.log('Данные:', req.body);
  
  const query = `
    INSERT INTO sensor_data 
    (latitude, longitude, temperature, humidity, pressureHPa, pressureMmHg, altitude, timestamp) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
  
  const values = [latitude, longitude, temperature, humidity, pressureHPa, pressureMmHg, altitude, timestamp];
  
  db.query(query, values, (err, results) => {
    if (err) {
      console.error('❌ Insert error:', err.message);
      res.status(500).json({ 
        success: false, 
        error: err.message 
      });
    } else {
      console.log('✅ Data saved to FreeDB. ID:', results.insertId);
      res.json({ 
        success: true, 
        message: 'Данные успешно сохранены в FreeDB',
        insertId: results.insertId 
      });
    }
  });
});

// Получение профиля пользователя (требует авторизацию)
app.get('/api/profile', authenticateToken, (req, res) => {
  const query = 'SELECT id, username, email, created_at FROM users WHERE id = ?';
  
  db.query(query, [req.user.userId], (err, results) => {
    if (err) {
      console.error('❌ Database error:', err.message);
      res.status(500).json({ 
        success: false, 
        error: err.message 
      });
    } else if (results.length === 0) {
      res.status(404).json({ 
        success: false, 
        error: 'Пользователь не найден' 
      });
    } else {
      res.json({
        success: true,
        user: results[0]
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
});
