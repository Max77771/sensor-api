const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 🔥 ОБНОВЛЕННЫЕ ДАННЫЕ ОТ FREEDB
const db = mysql.createConnection({
  host: "sql.freedb.tech",           // ИЗМЕНИТЬ
  user: "freedb_sensor_user",        // ИЗМЕНИТЬ
  password: "53dddC!A&VVuFjB",       // ИЗМЕНИТЬ
  database: "freedb_sensor_data",    // ИЗМЕНИТЬ
  port: 3306
});

// Проверка подключения
db.connect((err) => {
  if (err) {
    console.error('❌ Ошибка подключения к MySQL:', err.message);
  } else {
    console.log('✅ Успешно подключено к FreeDB MySQL');
  }
});

// Главная страница
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 Sensor API работает!',
    endpoints: {
      'GET /api/sensor-data': 'Получить последние данные',
      'POST /api/sensor-data': 'Отправить данные с Arduino'
    }
  });
});

// Получение последних данных
app.get('/api/sensor-data', (req, res) => {
  const query = 'SELECT * FROM sensor_data ORDER BY created_at DESC LIMIT 1';
  
  db.query(query, (err, results) => {
    if (err) {
      console.error('❌ Database error:', err.message);
      res.status(500).json({ error: err.message });
    } else {
      console.log('✅ Data retrieved:', results[0] || 'No data');
      res.json(results[0] || {});
    }
  });
});

// Отправка данных с Arduino
app.post('/api/sensor-data', (req, res) => {
  const { latitude, longitude, temperature, humidity, pressureHPa, pressureMmHg, altitude, timestamp } = req.body;
  
  console.log('📨 Получены данные с Arduino:', req.body);
  
  const query = `
    INSERT INTO sensor_data 
    (latitude, longitude, temperature, humidity, pressureHPa, pressureMmHg, altitude, timestamp) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
  
  const values = [latitude, longitude, temperature, humidity, pressureHPa, pressureMmHg, altitude, timestamp];
  
  db.query(query, values, (err, results) => {
    if (err) {
      console.error('❌ Insert error:', err.message);
      res.status(500).json({ error: err.message });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🚀 Sensor API запущен на порту ' + PORT);
});
