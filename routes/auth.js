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

    try {
      const user = await db.queryOne("SELECT * FROM users WHERE username = $1", [username]);
      if (!user) {
        return res.render('auth/login', {
          title: req.t('nav.login'),
          user: null,
          error: req.t('nav.login') === 'Login' ? 'Invalid username or password' : '用户名或密码错误',
          lang: req.lang,
          t: req.t
        });
      }

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
    } catch (err) {
      console.error('Login error:', err);
      res.render('auth/login', {
        title: req.t('nav.login'),
        user: null,
        error: '登录失败',
        lang: req.lang,
        t: req.t
      });
    }
  });

  router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/auth/login');
  });

  return router;
};
