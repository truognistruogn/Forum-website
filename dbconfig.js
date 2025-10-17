const config = {
  user: 'sa',  // Username SQL của bạn
  password: '12345',  // Password
  server: 'localhost',  // Hoặc IP
  database: 'Forum-DB',
  options: {
    encrypt: false,  // Nếu dùng Azure thì true
    trustServerCertificate: true  // Cho dev local
  },
  port: 1433  // Port mặc định SQL Server
};

// Hàm kết nối pool (export để server.js dùng)
const getPool = async () => {
  try {
    const pool = await sql.connect(dbConfig);
    console.log(' Connected to SQL Server');
    return pool;
  } catch (err) {
    console.error(' Database connection failed:', err);
    throw err;
  }
};

module.exports = config;