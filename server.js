const express = require('express');
const sql = require('mssql');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('./dbconfig.js');

const app = express();
const PORT = 5000;
const JWT_SECRET = 'your_jwt_secret_key_change_this_in_production';

app.use(bodyParser.json());
app.use(cors());
app.use(express.static('public')); // Chứa file HTML, CSS, JS

let pool;

// ===== KẾT NỐI SQL SERVER =====
async function connectDB() {
  try {
    pool = await sql.connect(config);
    console.log(' DB connected!');

    // Đảm bảo tài khoản admin tồn tại
    const hashedAdmin = await bcrypt.hash('admin123', 10);
    const existing = await pool.request()
      .input('username', sql.NVarChar, 'admin')
      .query('SELECT id, password FROM Users WHERE username = @username');

    if (existing.recordset.length === 0) {
      await pool.request()
        .input('username', sql.NVarChar, 'admin')
        .input('password', sql.NVarChar, hashedAdmin)
        .input('email', sql.NVarChar, 'admin@example.com')
        .input('role', sql.NVarChar, 'admin')
        .query('INSERT INTO Users (username, password, email, role) VALUES (@username, @password, @email, @role)');
      console.log(' Admin created: admin / admin123');
    } else {
      const match = await bcrypt.compare('admin123', existing.recordset[0].password);
      if (!match) {
        await pool.request()
          .input('id', sql.Int, existing.recordset[0].id)
          .input('password', sql.NVarChar, hashedAdmin)
          .query('UPDATE Users SET password = @password WHERE id = @id');
        console.log(' Admin password updated to admin123');
      } else {
        console.log(' Admin already exists');
      }
    }
  } catch (err) {
    console.error(' DB connection failed:', err);
  }
}
connectDB();

// ===== JWT AUTH MIDDLEWARE =====
async function authenticateToken(req, res, next) {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access denied' });
    const user = await jwt.verify(token, JWT_SECRET);
    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid token' });
  }
}

// ===== USER ROUTES =====
app.post('/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.request()
      .input('username', sql.NVarChar, username)
      .input('password', sql.NVarChar, hashed)
      .input('email', sql.NVarChar, email)
      .query('INSERT INTO Users (username, password, email) OUTPUT INSERTED.id VALUES (@username, @password, @email)');
    const token = jwt.sign({ id: result.recordset[0].id, role: 'user' }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch {
    res.status(400).json({ error: 'User exists' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.request().input('username', sql.NVarChar, username)
      .query('SELECT * FROM Users WHERE username = @username');
    const user = result.recordset[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== COMMENT ROUTES =====

// Tạo comment
app.post('/comments', authenticateToken, async (req, res) => {
  const { content, post_id } = req.body;
  await pool.request()
    .input('content', sql.NVarChar, content)
    .input('post_id', sql.Int, post_id)
    .input('user_id', sql.Int, req.user.id)
    .query('INSERT INTO Comments (content, post_id, user_id) VALUES (@content, @post_id, @user_id)');
  res.json({ success: true });
});

// Lấy comment theo bài viết
app.get('/comments/:post_id', async (req, res) => {
  const result = await pool.request()
    .input('post_id', sql.Int, req.params.post_id)
    .query('SELECT c.*, u.username FROM Comments c JOIN Users u ON c.user_id = u.id WHERE post_id = @post_id ORDER BY c.created_at');
  res.json(result.recordset);
});
app.delete('/comments/:id', authenticateToken, async (req, res) => {
  try {
    const commentId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Lấy thông tin comment để kiểm tra quyền
    const result = await pool.request()
      .input('id', sql.Int, commentId)
      .query('SELECT user_id FROM Comments WHERE id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy bình luận.' });
    }

    const commentOwnerId = result.recordset[0].user_id;

    // Chỉ admin hoặc người tạo comment mới có quyền xóa
    if (userRole !== 'admin' && userId !== commentOwnerId) {
      return res.status(403).json({ error: 'Bạn không có quyền xóa bình luận này.' });
    }

    // Tiến hành xóa
    await pool.request()
      .input('id', sql.Int, commentId)
      .query('DELETE FROM Comments WHERE id = @id');

    // Phản hồi thành công (không cần body, status 204 là đủ)
    res.sendStatus(204); 

  } catch (err) {
    console.error('Lỗi khi xóa comment:', err);
    res.status(500).json({ error: 'Lỗi máy chủ nội bộ.' });
  }
});







// ===== ERROR HANDLER =====
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

app.listen(PORT, () => console.log(` Server running at http://localhost:${PORT}`));
