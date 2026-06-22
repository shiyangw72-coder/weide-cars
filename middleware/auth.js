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
    return res.status(403).send('<html><head><meta charset=utf-8><title>权限不足</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>权限不足</h2><p class=text-muted>你没有权限访问此页面</p><a href=/admin class=btn btn-primary>返回后台</a></div></body></html>');
  }
  next();
}

function requireSub(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  if (req.session.user.role !== 'sub') {
    return res.status(403).send('<html><head><meta charset=utf-8><title>权限不足</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>权限不足</h2><p class=text-muted>仅子账号可访问此页面</p><a href=/admin class=btn btn-primary>返回后台</a></div></body></html>');
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireSub };
