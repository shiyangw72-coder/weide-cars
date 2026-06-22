const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'database.sqlite');

async function migrate() {
  const SQL = await initSqlJs();

  if (!fs.existsSync(DB_PATH)) {
    console.log('Database does not exist, no migration needed.');
    return;
  }

  const buffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buffer);

  db.run('PRAGMA foreign_keys=ON');

  // Check if license_plate column exists
  const cols = db.exec("PRAGMA table_info(cars)")[0];
  const colMap = {};
  cols.values.forEach(row => {
    colMap[row[1]] = row;
  });

  if (colMap['displacement']) {
    console.log('displacement column already exists.');
  } else if (colMap['license_plate']) {
    console.log('Renaming license_plate to displacement...');
    db.run("ALTER TABLE cars RENAME COLUMN license_plate TO displacement");
  } else {
    console.log('Adding displacement column...');
    db.run("ALTER TABLE cars ADD COLUMN displacement TEXT DEFAULT ''");
  }

  // Ensure description is NOT NULL
  try {
    db.run("UPDATE cars SET description = '' WHERE description IS NULL");
  } catch (e) {
    console.log('Could not update description:', e.message);
  }

  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();

  console.log('✅ Migration complete');
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
