// db.js - Ket noi SQL Server bang goi 'mssql' (tuong duong db.php dung PDO sqlsrv)
const sql = require('mssql');

const dbConfig = {
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASS || '',
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME || '',
  options: {
    // May chu SQL Server noi bo thuong dung self-signed cert / khong dung encrypt
    trustServerCertificate: true,
    encrypt: process.env.DB_ENCRYPT === 'true',
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let poolPromise = null;

/**
 * Lay (hoac tao moi) connection pool dung chung cho ca app.
 * Lazy-init: chi ket noi khi co request dau tien can DB.
 */
function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(dbConfig)
      .connect()
      .then((pool) => {
        console.log('[DB] Ket noi SQL Server thanh cong');
        return pool;
      })
      .catch((err) => {
        console.error('[DB] Ket noi that bai:', err.message);
        poolPromise = null; // cho phep thu lai o lan goi ke tiep
        throw err;
      });
  }
  return poolPromise;
}

module.exports = { sql, getPool };
