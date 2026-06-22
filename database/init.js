const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'database.sqlite');

let db = null;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');

  return db;
}

async function initDatabase() {
  const db = await getDb();

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'sub' CHECK(role IN ('admin', 'sub')),
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS car_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      car_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL CHECK(file_type IN ('image', 'video')),
      sort_order INTEGER DEFAULT 0,
      is_cover INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      contact_wechat TEXT DEFAULT '',
      contact_whatsapp TEXT DEFAULT '',
      contact_email TEXT DEFAULT '',
      updated_by INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert default site settings if not exists
  const settingsResult = db.exec("SELECT id FROM site_settings WHERE id = 1");
  if (!settingsResult.length || !settingsResult[0].values.length) {
    db.run("INSERT INTO site_settings (id) VALUES (1)");
  }

  // Create default admin if not exists
  const adminResult = db.exec("SELECT id FROM users WHERE username = 'admin'");
  if (!adminResult.length || !adminResult[0].values.length) {
    const hash = await bcrypt.hash('admin123', 10);
    db.run("INSERT INTO users (username, password, display_name, role) VALUES (?, ?, ?, ?)", 
      ['admin', hash, '管理员', 'admin']);
    console.log('✅ 默认管理员已创建: admin / admin123');
  }

  saveDb();
  console.log('✅ 数据库初始化完成');
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function closeDb() {
  if (db) {
    saveDb();
    db.close();
    db = null;
  }
}

// Helper functions for sql.js style queries
function queryAll(sql, params = []) {
  const result = db.exec(sql, params);
  if (!result.length) return [];
  
  const cols = result[0].columns;
  const rows = [];
  for (const vals of result[0].values) {
    const row = {};
    cols.forEach((col, i) => row[col] = vals[i]);
    rows.push(row);
  }
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length ? rows[0] : null;
}

function execute(sql, params = []) {
  db.run(sql, params);
}

function getLastInsertId() {
  const result = db.exec("SELECT last_insert_rowid() as id");
  return result[0].values[0][0];
}

module.exports = { getDb, initDatabase, saveDb, closeDb, queryAll, queryOne, execute, getLastInsertId };
