const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.cwd(), 'data', 'database.sqlite');

initSqlJs().then(SQL => {
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const cols = db.exec('PRAGMA table_info(cars)')[0];
  cols.values.forEach(row => console.log(row[1] + ' | ' + row[2] + ' | ' + row[3] + ' | ' + row[4]));
  db.close();
});
