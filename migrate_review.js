const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');

async function migrate() {
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buffer);

  // Get current cars columns
  const tableInfo = db.exec('PRAGMA table_info(cars)');
  const cols = tableInfo[0].values.map(v => v[1]);
  console.log('Current cars columns:', cols.join(', '));

  if (!cols.includes('cost_price')) {
    // Need to recreate cars table to add cost_price and update CHECK constraint
    db.run(`
      CREATE TABLE cars_new (
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
        license_plate TEXT DEFAULT '',
        description TEXT DEFAULT '',
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'sold', 'pending')),
        created_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);

    // Copy data from old cars table
    db.run(`
      INSERT INTO cars_new (
        id, brand, model, year, mileage, price, cost_price, color, fuel_type, transmission, category, license_plate, description, status, created_by, created_at, updated_at
      )
      SELECT id, brand, model, year, mileage, price, NULL, color, fuel_type, transmission, category, license_plate, description, status, created_by, created_at, updated_at FROM cars
    `);

    db.run('DROP TABLE cars');
    db.run('ALTER TABLE cars_new RENAME TO cars');

    console.log('✅ Recreated cars table with cost_price and pending status support');
  } else {
    console.log('✅ cost_price column already exists');
  }

  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();
  console.log('Migration done');
}

migrate().catch(e => console.error(e));
