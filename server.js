const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { pool, initDatabase } = require('./database'); // Import PostgreSQL

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_change_this_in_production';

// Middleware
app.use(bodyParser.json());
app.use(cors());
app.use(express.static('public'));

// ===== JWT AUTH MIDDLEWARE =====
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
}

// ===== USER ROUTES (PostgreSQL) =====
app.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Validation
    if (!username || username.length < 3) {
      return res.status(400).json({ error: 'Username phải có ít nhất 3 ký tự' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      `INSERT INTO users (username, email, password) 
       VALUES ($1, $2, $3) 
       RETURNING id, username, email, role`,
      [username, email, hashedPassword]
    );

    const newUser = result.rows[0];
    const token = jwt.sign(
      { id: newUser.id, username: newUser.username, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        role: newUser.role,
        email: newUser.email
      }
    });

  } catch (error) {
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Username hoặc email đã tồn tại' });
    }
    console.error('Register error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Thông tin đăng nhập không đúng' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Thông tin đăng nhập không đúng' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ===== POST ROUTES (PostgreSQL) =====
app.get('/posts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, u.username,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND type = 'like') as like_count,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND type = 'dislike') as dislike_count,
      EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $1 AND type = 'like') as liked_by_user,
      EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $1 AND type = 'dislike') as disliked_by_user
      FROM posts p
      JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
    `, [req.user?.id || 0]);

    res.json(result.rows);
  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.post('/posts', authenticateToken, async (req, res) => {
  try {
    const { title, content } = req.body;

    const result = await pool.query(
      `INSERT INTO posts (title, content, user_id) 
       VALUES ($1, $2, $3) 
       RETURNING *`,
      [title, content, req.user.id]
    );

    const newPost = result.rows[0];
    
    // Get username
    const userResult = await pool.query(
      'SELECT username FROM users WHERE id = $1',
      [req.user.id]
    );

    newPost.username = userResult.rows[0].username;
    newPost.like_count = 0;
    newPost.dislike_count = 0;
    newPost.liked_by_user = false;
    newPost.disliked_by_user = false;

    res.json(newPost);

  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.put('/posts/:id', authenticateToken, async (req, res) => {
  try {
    const { title, content } = req.body;
    const postId = req.params.id;

    // Check if post exists and user has permission
    const postResult = await pool.query(
      'SELECT * FROM posts WHERE id = $1',
      [postId]
    );

    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bài viết không tồn tại' });
    }

    const post = postResult.rows[0];
    if (post.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Không có quyền chỉnh sửa bài viết này' });
    }

    const updateResult = await pool.query(
      'UPDATE posts SET title = $1, content = $2 WHERE id = $3 RETURNING *',
      [title, content, postId]
    );

    const updatedPost = updateResult.rows[0];
    updatedPost.username = post.username;

    res.json(updatedPost);

  } catch (error) {
    console.error('Update post error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.delete('/posts/:id', authenticateToken, async (req, res) => {
  try {
    const postId = req.params.id;

    // Check if post exists
    const postResult = await pool.query(
      'SELECT * FROM posts WHERE id = $1',
      [postId]
    );

    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bài viết không tồn tại' });
    }

    const post = postResult.rows[0];
    if (post.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Không có quyền xóa bài viết này' });
    }

    await pool.query('DELETE FROM posts WHERE id = $1', [postId]);
    res.json({ success: true, message: 'Bài viết đã được xóa' });

  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ===== COMMENT ROUTES (PostgreSQL) =====
app.get('/comments/:post_id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, u.username 
      FROM comments c 
      JOIN users u ON c.user_id = u.id 
      WHERE post_id = $1 
      ORDER BY c.created_at ASC
    `, [req.params.post_id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.post('/comments', authenticateToken, async (req, res) => {
  try {
    const { content, post_id } = req.body;

    const result = await pool.query(
      `INSERT INTO comments (content, post_id, user_id) 
       VALUES ($1, $2, $3) 
       RETURNING *`,
      [content, post_id, req.user.id]
    );

    const newComment = result.rows[0];
    
    // Get username
    const userResult = await pool.query(
      'SELECT username FROM users WHERE id = $1',
      [req.user.id]
    );

    newComment.username = userResult.rows[0].username;
    res.json(newComment);

  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.delete('/comments/:id', authenticateToken, async (req, res) => {
  try {
    const commentId = req.params.id;

    // Check if comment exists
    const commentResult = await pool.query(
      'SELECT * FROM comments WHERE id = $1',
      [commentId]
    );

    if (commentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bình luận không tồn tại' });
    }

    const comment = commentResult.rows[0];
    if (comment.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Không có quyền xóa bình luận này' });
    }

    await pool.query('DELETE FROM comments WHERE id = $1', [commentId]);
    res.json({ success: true, message: 'Bình luận đã được xóa' });

  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ===== LIKE ROUTES (PostgreSQL) =====
app.post('/likes', authenticateToken, async (req, res) => {
  try {
    const { post_id, type } = req.body;

    // Check if like exists
    const existing = await pool.query(
      'SELECT * FROM likes WHERE post_id = $1 AND user_id = $2',
      [post_id, req.user.id]
    );

    if (existing.rows.length > 0) {
      const existingLike = existing.rows[0];
      if (existingLike.type === type) {
        // Remove like
        await pool.query(
          'DELETE FROM likes WHERE post_id = $1 AND user_id = $2',
          [post_id, req.user.id]
        );
      } else {
        // Update like type
        await pool.query(
          'UPDATE likes SET type = $1 WHERE post_id = $2 AND user_id = $3',
          [type, post_id, req.user.id]
        );
      }
    } else {
      // Add new like
      await pool.query(
        'INSERT INTO likes (post_id, user_id, type) VALUES ($1, $2, $3)',
        [post_id, req.user.id, type]
      );
    }

    // Get updated counts
    const likeResult = await pool.query(
      'SELECT COUNT(*) as count FROM likes WHERE post_id = $1 AND type = $2',
      [post_id, 'like']
    );

    const dislikeResult = await pool.query(
      'SELECT COUNT(*) as count FROM likes WHERE post_id = $1 AND type = $2',
      [post_id, 'dislike']
    );

    const userLikeResult = await pool.query(
      'SELECT type FROM likes WHERE post_id = $1 AND user_id = $2',
      [post_id, req.user.id]
    );

    res.json({
      like_count: parseInt(likeResult.rows[0].count),
      dislike_count: parseInt(dislikeResult.rows[0].count),
      liked_by_user: userLikeResult.rows.some(like => like.type === 'like'),
      disliked_by_user: userLikeResult.rows.some(like => like.type === 'dislike')
    });

  } catch (error) {
    console.error('Like error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ===== ADMIN ROUTES =====
app.get('/users', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ admin mới có quyền truy cập' });
  }

  try {
    const result = await pool.query(
      'SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.delete('/users/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ admin mới có quyền xóa user' });
  }

  try {
    const userId = req.params.id;
    
    // Prevent self-deletion
    if (parseInt(userId) === req.user.id) {
      return res.status(400).json({ error: 'Không thể xóa chính mình' });
    }

    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ success: true, message: 'User đã được xóa' });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ===== DEBUG ROUTES =====
app.get('/api/debug/database', async (req, res) => {
  try {
    // Test connection
    const connectionTest = await pool.query('SELECT NOW() as time');
    
    // Check tables
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    // Check users
    const usersResult = await pool.query('SELECT COUNT(*) as count FROM users');
    
    res.json({
      database_connected: true,
      current_time: connectionTest.rows[0].time,
      tables: tablesResult.rows.map(row => row.table_name),
      users_count: parseInt(usersResult.rows[0].count),
      environment: {
        node_env: process.env.NODE_ENV,
        has_database_url: !!process.env.DATABASE_URL,
        database_url_length: process.env.DATABASE_URL ? process.env.DATABASE_URL.length : 0
      }
    });
  } catch (error) {
    res.json({
      database_connected: false,
      error: error.message,
      environment: {
        node_env: process.env.NODE_ENV,
        has_database_url: !!process.env.DATABASE_URL,
        database_url_length: process.env.DATABASE_URL ? process.env.DATABASE_URL.length : 0
      }
    });
  }
});

// Manual table initialization endpoint
app.post('/api/debug/init-tables', async (req, res) => {
  try {
    await initDatabase();
    res.json({ success: true, message: 'Tables initialized manually' });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ===== SERVE FRONTEND =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ===== ERROR HANDLER =====
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// ===== START SERVER =====
async function startServer() {
  try {
    console.log('🚀 Starting server initialization...');
    
    // Initialize database trước
    console.log('🔄 Initializing database...');
    await initDatabase();
    console.log('✅ Database initialization completed');
    
    // Start server sau
    app.listen(PORT, () => {
      console.log('🚀 ======================================');
      console.log('🎯 DIỄN ĐÀN FORUM - SERVER STARTED');
      console.log('🚀 ======================================');
      console.log(`📍 Port: ${PORT}`);
      console.log(`🌐 URL: http://localhost:${PORT}`);
      console.log(`🗃️ Database: PostgreSQL`);
      console.log('👤 Admin: admin / admin123');
      console.log('🚀 ======================================');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();