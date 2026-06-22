const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('PostgreSQL 连接错误:', err.message);
});

async function query(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

async function execute(sql, params = []) {
  return pool.query(sql, params);
}

async function getClient() {
  return pool.connect();
}

async function initDatabase() {
  console.log('正在连接 PostgreSQL...');

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'sub' CHECK(role IN ('admin', 'sub')),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS cars (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      year INTEGER,
      mileage INTEGER,
      price REAL,
      cost_price REAL,
      color TEXT DEFAULT '',
      fuel_type TEXT DEFAULT '',
      transmission TEXT DEFAULT '',
      category TEXT DEFAULT '',
      displacement TEXT DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'sold', 'pending')),
      contact_wechat TEXT DEFAULT '',
      contact_whatsapp TEXT DEFAULT '',
      contact_email TEXT DEFAULT '',
      translations JSONB DEFAULT '{}',
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS car_media (
      id SERIAL PRIMARY KEY,
      car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL CHECK(file_type IN ('image', 'video')),
      sort_order INTEGER DEFAULT 0,
      is_cover INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      contact_wechat TEXT DEFAULT '',
      contact_whatsapp TEXT DEFAULT '',
      contact_email TEXT DEFAULT '',
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert default site settings if not exists
  const settings = await queryOne("SELECT id FROM site_settings WHERE id = 1");
  if (!settings) {
    await query("INSERT INTO site_settings (id) VALUES (1)");
  }

  // Create default admin if not exists
  const admin = await queryOne("SELECT id FROM users WHERE username = 'admin'");
  if (!admin) {
    const hash = await bcrypt.hash('admin123', 10);
    await query("INSERT INTO users (username, password, display_name, role) VALUES ($1, $2, $3, $4)",
      ['admin', hash, '管理员', 'admin']);
    console.log('✅ 默认管理员已创建: admin / admin123');
  }

  console.log('✅ 数据库初始化完成');
  return { query, queryOne, execute, getClient };
}

// No-op for PG (auto-persists)
function saveDb() {}

async function closeDb() {
  await pool.end();
}

module.exports = { initDatabase, saveDb, closeDb, query, queryOne, execute, getClient };
