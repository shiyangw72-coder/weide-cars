const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');

async function migrate() {
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buffer);
  
  const tableInfo = db.exec('PRAGMA table_info(cars)');
  const cols = tableInfo[0].values.map(v => v[1]);
  console.log('Columns:', cols.join(', '));
  
  if (!cols.includes('category')) {
    db.run("ALTER TABLE cars ADD COLUMN category TEXT DEFAULT ''");
    console.log('Added category column');
  } else {
    console.log('Category column exists');
  }
  
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();
  console.log('Done');
}

migrate().catch(e => console.error(e));
