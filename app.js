require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// i18n middleware
const { i18nMiddleware } = require('./middleware/i18n');

// Ensure uploads directory
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Catch EJS render errors
app.use((req, res, next) => {
  const origRender = res.render.bind(res);
  res.render = function(view, locals, callback) {
    try {
      return origRender(view, locals, (err, html) => {
        if (err) {
          console.error('[EJS ERROR]', view, err.message);
          console.error(err.stack);
        }
        if (callback) return callback(err, html);
        if (err) {
          return res.status(500).send('<h1>Template Error</h1><pre>' + err.message + '</pre>');
        }
        res.send(html);
      });
    } catch(e) {
      console.error('[EJS FATAL]', view, e.message);
      res.status(500).send('<h1>Render Error</h1><pre>' + e.message + '</pre>');
    }
  };
  next();
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Session (before i18n so language can be stored)
app.use(session({
  secret: process.env.SESSION_SECRET || 'car-dealer-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// i18n (after session so it can use req.session)
app.use(i18nMiddleware);

// Initialize database
const { initDatabase, saveDb, closeDb } = require('./database/pg');

async function start() {
  try {
    const db = await initDatabase();

    // Routes - db is now { query, queryOne, execute, getClient }
    const publicRoutes = require('./routes/public')(db, saveDb);
    const authRoutes = require('./routes/auth')(db, saveDb);
    const adminRoutes = require('./routes/admin')(db, saveDb);

    app.use('/', publicRoutes);
    app.use('/auth', authRoutes);
    app.use('/admin', adminRoutes);

    // Error page route
    app.get('/error', (req, res) => {
      res.render('error', {
        title: '错误',
        message: req.query.message || '发生了未知错误',
        user: req.session.user || null
      });
    });

    // 404
    app.use((req, res) => {
      res.status(404).render('error', {
        title: '404',
        message: '页面不存在',
        user: req.session.user || null
      });
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n关闭服务器...');
      closeDb();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      closeDb();
      process.exit(0);
    });

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n================================`);
      console.log(`  二手车展示网站已启动!`);
      console.log(`================================`);
      console.log(`  本地访问: http://localhost:${PORT}`);
      console.log(`  局域网访问: http://你的IP:${PORT}`);
      console.log(`  管理后台: http://localhost:${PORT}/admin`);
      console.log(`  管理员账号: admin / admin123`);
      console.log(`================================\n`);
    });
  } catch (err) {
    console.error('启动失败:', err);
    process.exit(1);
  }
}

start();
