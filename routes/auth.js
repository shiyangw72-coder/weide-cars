const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

module.exports = function(db, saveDb) {

  router.get('/login', (req, res) => {
    if (req.session.user) {
      return res.redirect('/admin');
    }
    res.render('auth/login', { 
      title: req.t('nav.login'),
      user: null,
      error: null,
      lang: req.lang,
      t: req.t
    });
  });

  router.post('/login', async (req, res) => {
    const { username, password, lang } = req.body;
    
    if (!username || !password) {
      return res.render('auth/login', {
        title: req.t('nav.login'),
        user: null,
        error: req.t('nav.login') === 'Login' ? 'Please enter username and password' : '请输入用户名和密码',
        lang: req.lang,
        t: req.t
      });
    }

    const result = db.exec("SELECT * FROM users WHERE username = ?", [username]);
    if (!result.length || !result[0].values.length) {
      return res.render('auth/login', {
        title: req.t('nav.login'),
        user: null,
        error: req.t('nav.login') === 'Login' ? 'Invalid username or password' : '用户名或密码错误',
        lang: req.lang,
        t: req.t
      });
    }

    const cols = result[0].columns;
    const vals = result[0].values[0];
    const user = {};
    cols.forEach((col, i) => user[col] = vals[i]);

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.render('auth/login', {
        title: req.t('nav.login'),
        user: null,
        error: req.t('nav.login') === 'Login' ? 'Invalid username or password' : '用户名或密码错误',
        lang: req.lang,
        t: req.t
      });
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role
    };

    res.redirect('/admin');
  });

  router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/auth/login');
  });

  return router;
};
