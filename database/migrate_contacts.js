const { initDatabase } = require('./init');

async function migrate() {
  const db = await initDatabase();

  console.log('Adding contact fields to cars...');

  const run = (sql) => new Promise((res, rej) => {
    try {
      db.run(sql);
      res();
    } catch(e) {
      if (e.message.includes('duplicate column') || e.message.includes('already exists')) {
        res('exists');
      } else {
        rej(e);
      }
    }
  });

  try {
    const r1 = await run("ALTER TABLE cars ADD COLUMN contact_wechat TEXT DEFAULT ''");
    console.log(r1 === 'exists' ? 'ℹ contact_wechat already exists' : '✅ contact_wechat added');
  } catch(e) { console.error('❌ contact_wechat:', e.message); }

  try {
    const r2 = await run("ALTER TABLE cars ADD COLUMN contact_whatsapp TEXT DEFAULT ''");
    console.log(r2 === 'exists' ? 'ℹ contact_whatsapp already exists' : '✅ contact_whatsapp added');
  } catch(e) { console.error('❌ contact_whatsapp:', e.message); }

  try {
    const r3 = await run("ALTER TABLE cars ADD COLUMN contact_email TEXT DEFAULT ''");
    console.log(r3 === 'exists' ? 'ℹ contact_email already exists' : '✅ contact_email added');
  } catch(e) { console.error('❌ contact_email:', e.message); }

  const { saveDb } = require('./init');
  saveDb();
  console.log('✅ Migration complete');
  process.exit(0);
}

migrate();
