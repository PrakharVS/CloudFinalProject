const express = require('express');
const axios = require('axios');
const sql = require('mssql');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// ✅ Middleware setup
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.use(session({
  secret: 'your_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// ✅ Gemini API configuration
const GEMINI_API_KEY = 'AIzaSyC6gGplIhh8WWipu6vgKvTdaC9T4roFTyw';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// ✅ Azure SQL Configuration (correct format)
const sqlConfig = {
  user: 'prakhar', // only your SQL username, not email-style
  password: 'Singha@321',
  server: 'prakhar.database.windows.net',
  database: 'Prakhar',
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
};

// ✅ Ensure tables exist
const createTables = async () => {
  try {
    const pool = await sql.connect(sqlConfig);

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Users')
      CREATE TABLE Users (
        id INT IDENTITY(1,1) PRIMARY KEY,
        username NVARCHAR(255) UNIQUE,
        email NVARCHAR(255) UNIQUE,
        password NVARCHAR(255)
      )
    `);

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ChatHistory')
      CREATE TABLE ChatHistory (
        id INT IDENTITY(1,1) PRIMARY KEY,
        userId INT,
        userMessage NVARCHAR(MAX),
        botResponse NVARCHAR(MAX),
        timestamp DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE
      )
    `);

    console.log("✅ Tables verified or created successfully.");
  } catch (err) {
    console.error("❌ Error ensuring tables:", err);
  }
};

// 📝 Register
app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const pool = await sql.connect(sqlConfig);

    const checkUser = await pool.request()
      .input('email', sql.NVarChar, email)
      .input('username', sql.NVarChar, username)
      .query('SELECT * FROM Users WHERE email = @email OR username = @username');

    if (checkUser.recordset.length > 0) {
      return res.status(400).json({ message: 'User already exists' });
    }

    await pool.request()
      .input('username', sql.NVarChar, username)
      .input('email', sql.NVarChar, email)
      .input('password', sql.NVarChar, hashedPassword)
      .query('INSERT INTO Users (username, email, password) VALUES (@username, @email, @password)');

    res.json({ message: 'Registered successfully' });
  } catch (err) {
    console.error("❌ Register error:", err);
    res.status(500).json({ message: 'Error registering user' });
  }
});

// 🔐 Login
app.post('/login', async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request()
      .input('identifier', sql.NVarChar, identifier)
      .query('SELECT * FROM Users WHERE email = @identifier OR username = @identifier');

    const user = result.recordset[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    req.session.user = { id: user.id, email: user.email, username: user.username };
    res.json({ message: 'Login successful' });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ message: 'Login failed' });
  }
});

// 🔒 Check Auth
app.get('/check-auth', (req, res) => {
  res.json({ loggedIn: !!req.session.user, user: req.session.user || null });
});

// 🚪 Logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logged out' }));
});

// 💬 Chat Route
app.post('/chat', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ message: 'Unauthorized' });

  const { message } = req.body;
  if (!message) return res.status(400).json({ message: 'Message required' });

  try {
    const geminiResponse = await axios.post(
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: message }] }] }
    );

    const botReply = geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn’t understand that.";

    const pool = await sql.connect(sqlConfig);
    await pool.request()
      .input('userId', sql.Int, user.id)
      .input('userMessage', sql.NVarChar, message)
      .input('botResponse', sql.NVarChar, botReply)
      .query('INSERT INTO ChatHistory (userId, userMessage, botResponse) VALUES (@userId, @userMessage, @botResponse)');

    res.json({ reply: botReply });
  } catch (err) {
    console.error("❌ Chat error:", err.response?.data || err.message);
    res.status(500).json({ reply: 'Something went wrong.' });
  }
});

// 📜 Chat History
app.get('/history', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request()
      .input('userId', sql.Int, user.id)
      .query('SELECT TOP 20 userMessage, botResponse FROM ChatHistory WHERE userId = @userId ORDER BY timestamp DESC');

    res.json(result.recordset);
  } catch (err) {
    console.error("❌ History error:", err);
    res.status(500).json({ message: 'Error fetching history' });
  }
});

// ❌ Delete Chat History
app.delete('/delete-history', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const pool = await sql.connect(sqlConfig);
    await pool.request()
      .input('userId', sql.Int, user.id)
      .query('DELETE FROM ChatHistory WHERE userId = @userId');

    res.json({ message: 'Chat history deleted' });
  } catch (err) {
    console.error("❌ Delete history error:", err);
    res.status(500).json({ message: 'Error deleting history' });
  }
});

// 🚀 Start Server
app.listen(port, async () => {
  await createTables();
  console.log(`✅ Server running at http://localhost:${port}`);
});
