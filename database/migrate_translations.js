const { initDatabase } = require('./init');

async function migrate() {
  const db = await initDatabase();

  console.log('Adding translations column to cars...');

  const run = (sql) => new Promise((res) => {
    try {
      db.run(sql);
      res('ok');
    } catch(e) {
      if (e.message.includes('duplicate') || e.message.includes('already')) res('exists');
      else { console.error('ERROR:', e.message); res('err'); }
    }
  });

  const r = await run("ALTER TABLE cars ADD COLUMN translations TEXT DEFAULT '{}'");
  console.log(r === 'exists' ? 'ℹ translations already exists' : r === 'ok' ? '✅ translations added' : '❌');

  const { saveDb } = require('./init');
  saveDb();
  console.log('✅ Migration complete');
  process.exit(0);
}

migrate();
