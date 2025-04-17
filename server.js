const express = require('express');
const axios = require('axios');
const sql = require('mssql');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const app = express();
const port = 3000;

app.use(express.static('public'));
app.use(express.json());

app.use(session({
  secret: 'your_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

const GEMINI_API_KEY = 'AIzaSyC6gGplIhh8WWipu6vgKvTdaC9T4roFTyw';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const sqlConfig = {
  user: 'prakhar@prakharvs',
  password: 'Singha@321',
  server: 'prakharvs.database.windows.net',
  database: 'Prakhar',
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};

// 🔧 Ensure Tables
const createTables = async () => {
  try {
    await sql.connect(sqlConfig);

    // Users table
    await sql.query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Users')
      BEGIN
        CREATE TABLE Users (
          id INT IDENTITY(1,1) PRIMARY KEY,
          username NVARCHAR(255) UNIQUE,
          email NVARCHAR(255) UNIQUE,
          password NVARCHAR(255)
        )
      END
    `);

    // ChatHistory table
    await sql.query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ChatHistory')
      BEGIN
        CREATE TABLE ChatHistory (
          id INT IDENTITY(1,1) PRIMARY KEY,
          userId INT,
          userMessage NVARCHAR(MAX),
          botResponse NVARCHAR(MAX),
          timestamp DATETIME DEFAULT GETDATE(),
          FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE
        )
      END
    `);

    console.log("Tables ensured.");
  } catch (err) {
    console.error("Error ensuring tables:", err);
  }
};

// 📝 Register
app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);

  try {
    await sql.connect(sqlConfig);

    const check = await sql.query`SELECT * FROM Users WHERE email = ${email} OR username = ${username}`;
    if (check.recordset.length > 0) {
      return res.status(400).json({ message: 'User with this email or username already exists' });
    }

    await sql.query`INSERT INTO Users (username, email, password) VALUES (${username}, ${email}, ${hashed})`;
    res.json({ message: 'Registered successfully' });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: 'Error registering user' });
  }
});

// 🔐 Login (username or email)
app.post('/login', async (req, res) => {
  const { identifier, password } = req.body; // identifier can be email or username

  try {
    await sql.connect(sqlConfig);
    const result = await sql.query`
      SELECT * FROM Users 
      WHERE email = ${identifier} OR username = ${identifier}
    `;
    const user = result.recordset[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    req.session.user = { id: user.id, email: user.email, username: user.username };
    res.json({ message: 'Login successful' });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: 'Login failed' });
  }
});

// 🔒 Auth check
app.get('/check-auth', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

// 🚪 Logout
app.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out' });
});

// 🤖 Chat + Save
app.post('/chat', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ message: 'Unauthorized' });

  const userMsg = req.body.message;

  try {
    const geminiResponse = await axios.post(
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: userMsg }] }] }
    );

    const botReply = geminiResponse.data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't understand that.";

    await sql.connect(sqlConfig);
    await sql.query`
      INSERT INTO ChatHistory (userId, userMessage, botResponse)
      VALUES (${user.id}, ${userMsg}, ${botReply})
    `;

    res.json({ reply: botReply });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ reply: 'Something went wrong.' });
  }
});

// 📜 History
app.get('/history', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ message: 'Unauthorized' });

  try {
    await sql.connect(sqlConfig);
    const result = await sql.query`
      SELECT TOP 20 userMessage, botResponse FROM ChatHistory
      WHERE userId = ${user.id} ORDER BY timestamp DESC
    `;
    res.json(result.recordset);
  } catch (err) {
    console.error("History error:", err);
    res.status(500).json({ message: 'Error fetching history' });
  }
});

// ❌ Delete Chat
app.delete('/delete-history', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ message: 'Unauthorized' });

  try {
    await sql.connect(sqlConfig);
    await sql.query`DELETE FROM ChatHistory WHERE userId = ${user.id}`;
    res.json({ message: 'Chat history deleted' });
  } catch (err) {
    console.error("Delete history error:", err);
    res.status(500).json({ message: 'Error deleting history' });
  }
});

// Start server
app.listen(port, async () => {
  await createTables();
  console.log(`✅ Server running at http://localhost:${port}`);
});
