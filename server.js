const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./dbconfig');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_in_production';

// 🔥 TỰ ĐỘNG TẠO TABLES KHI SERVER START
async function initializeDatabase() {
  try {
    console.log('🔄 Đang khởi tạo database...');
    
    // Tạo bảng Users
    await db.query(`
      CREATE TABLE IF NOT EXISTS Users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Bảng Users đã sẵn sàng');

    // Tạo bảng Posts
    await db.query(`
      CREATE TABLE IF NOT EXISTS Posts (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        content TEXT NOT NULL,
        user_id INTEGER REFERENCES Users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Bảng Posts đã sẵn sàng');

    // Tạo bảng Comments
    await db.query(`
      CREATE TABLE IF NOT EXISTS Comments (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        post_id INTEGER REFERENCES Posts(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES Users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Bảng Comments đã sẵn sàng');

    // Tạo bảng Likes
    await db.query(`
      CREATE TABLE IF NOT EXISTS Likes (
        id SERIAL PRIMARY KEY,
        post_id INTEGER REFERENCES Posts(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES Users(id) ON DELETE CASCADE,
        type VARCHAR(10) CHECK (type IN ('like', 'dislike')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(post_id, user_id)
      )
    `);
    console.log('✅ Bảng Likes đã sẵn sàng');

    // Kiểm tra và tạo admin user
    const adminCheck = await db.query('SELECT id FROM Users WHERE username = $1', ['admin']);
    if (adminCheck.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await db.query(
        'INSERT INTO Users (username, email, password, role) VALUES ($1, $2, $3, $4)',
        ['admin', 'admin@example.com', hashedPassword, 'admin']
      );
      console.log('✅ Admin user đã tạo: admin / admin123');
    } else {
      console.log('✅ Admin user đã tồn tại');
    }
    
    console.log('🎉 Database khởi tạo thành công!');
  } catch (error) {
    console.error('❌ Lỗi khởi tạo database:', error.message);
  }
}

// Khởi tạo database khi server start
initializeDatabase();

// Middleware
app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// === API ROUTES ===

// Register
app.post('/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await db.query(
      'INSERT INTO Users (username, password, email) VALUES ($1, $2, $3) RETURNING id, username',
      [username, hashedPassword, email]
    );
    
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, role: 'user' }, JWT_SECRET, { expiresIn: '1h' });
    
    res.json({ token, user: { id: user.id, username: user.username, role: 'user' } });
  } catch (err) {
    if (err.code === '23505') {
      res.status(400).json({ error: 'Username or email already exists' });
    } else {
      console.error('Register error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  }
});

// Login
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const result = await db.query(
      'SELECT * FROM Users WHERE username = $1',
      [username]
    );
    
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ 
      token, 
      user: { 
        id: user.id, 
        username: user.username, 
        role: user.role 
      } 
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all users (Admin only)
app.get('/users', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  
  const result = await db.query('SELECT id, username, email, role FROM Users');
  res.json(result.rows);
});

// Delete user (Admin only)
app.delete('/users/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  
  await db.query('DELETE FROM Users WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// Get all posts
app.get('/posts', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.*, u.username, u.id as user_id,
      (SELECT COUNT(*) FROM Likes l WHERE l.post_id = p.id AND l.type = 'like') as like_count,
      (SELECT COUNT(*) FROM Likes l WHERE l.post_id = p.id AND l.type = 'dislike') as dislike_count
      FROM Posts p 
      JOIN Users u ON p.user_id = u.id 
      ORDER BY p.created_at DESC
    `);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Get posts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create post
app.post('/posts', authenticateToken, async (req, res) => {
  try {
    const { title, content } = req.body;
    
    const result = await db.query(
      'INSERT INTO Posts (title, content, user_id) VALUES ($1, $2, $3) RETURNING id',
      [title, content, req.user.id]
    );
    
    res.json({ id: result.rows[0].id });
  } catch (err) {
    console.error('Create post error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update post
app.put('/posts/:id', authenticateToken, async (req, res) => {
  try {
    const { title, content } = req.body;
    
    const result = await db.query(
      'UPDATE Posts SET title = $1, content = $2 WHERE id = $3 AND user_id = $4',
      [title, content, req.params.id, req.user.id]
    );
    
    if (result.rowCount === 0) {
      return res.status(403).json({ error: 'Not owner or post not found' });
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Update post error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete post
app.delete('/posts/:id', authenticateToken, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    let query = 'DELETE FROM Posts WHERE id = $1';
    let params = [req.params.id];
    
    if (!isAdmin) {
      query += ' AND user_id = $2';
      params.push(req.user.id);
    }
    
    const result = await db.query(query, params);
    
    if (result.rowCount === 0) {
      return res.status(403).json({ error: 'Permission denied or post not found' });
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Delete post error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create comment
app.post('/comments', authenticateToken, async (req, res) => {
  try {
    const { content, post_id } = req.body;
    
    await db.query(
      'INSERT INTO Comments (content, post_id, user_id) VALUES ($1, $2, $3)',
      [content, post_id, req.user.id]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('Create comment error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get comments for post
app.get('/comments/:post_id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, u.username 
       FROM Comments c 
       JOIN Users u ON c.user_id = u.id 
       WHERE c.post_id = $1 
       ORDER BY c.created_at`,
      [req.params.post_id]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error('Get comments error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete comment
app.delete('/comments/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const commentResult = await db.query(
      'SELECT user_id FROM Comments WHERE id = $1',
      [id]
    );
    
    if (commentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    
    const comment = commentResult.rows[0];
    const isAdmin = req.user.role === 'admin';
    const isOwner = comment.user_id === req.user.id;
    
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: 'Unauthorized to delete this comment' });
    }
    
    await db.query('DELETE FROM Comments WHERE id = $1', [id]);
    res.json({ message: 'Comment deleted successfully' });
  } catch (err) {
    console.error('Delete comment error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Like/Dislike post
app.post('/likes', authenticateToken, async (req, res) => {
  try {
    const { post_id, type } = req.body;
    
    if (type !== 'like' && type !== 'dislike') {
      return res.status(400).json({ error: 'Invalid type' });
    }
    
    // Check existing like
    const existingResult = await db.query(
      'SELECT type FROM Likes WHERE post_id = $1 AND user_id = $2',
      [post_id, req.user.id]
    );
    
    if (existingResult.rows.length > 0) {
      const existingType = existingResult.rows[0].type;
      
      if (existingType === type) {
        // Remove like/dislike
        await db.query(
          'DELETE FROM Likes WHERE post_id = $1 AND user_id = $2',
          [post_id, req.user.id]
        );
        res.json({ success: true, action: 'removed' });
      } else {
        // Switch type
        await db.query(
          'UPDATE Likes SET type = $1 WHERE post_id = $2 AND user_id = $3',
          [type, post_id, req.user.id]
        );
        res.json({ success: true, action: 'switched' });
      }
    } else {
      // Add new like/dislike
      await db.query(
        'INSERT INTO Likes (post_id, user_id, type) VALUES ($1, $2, $3)',
        [post_id, req.user.id, type]
      );
      res.json({ success: true, action: 'added' });
    }
  } catch (err) {
    console.error('Like error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Auth middleware
function authenticateToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied' });
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});