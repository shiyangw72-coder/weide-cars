const init = require('./database/init');
init.getDb().then(db => {
  const r = db.exec('SELECT id, brand, model FROM cars');
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
});
