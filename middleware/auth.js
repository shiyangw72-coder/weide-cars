function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('error', {
      title: '权限不足',
      message: '你没有权限访问此页面',
      user: req.session.user
    });
  }
  next();
}

function requireSub(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  if (req.session.user.role !== 'sub') {
    return res.status(403).render('error', {
      title: '权限不足',
      message: '仅子账号可访问此页面',
      user: req.session.user
    });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireSub };
