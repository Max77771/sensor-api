const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

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
      'GET /api/sensor-data': 'Получить последние данные',
      'POST /api/sensor-data': 'Отправить данные с Arduino',
      'GET /api/profile': 'Получить профиль'
    }
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
});
