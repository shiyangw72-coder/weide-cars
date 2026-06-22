const fs = require('fs');
let code = fs.readFileSync('routes/admin.js', 'utf8');
const before = (code.match(/render\('error'/g) || []).length;
code = code.replace(/res\.status\(\d+\)\.render\('error'\s*,\s*\{[\s\S]*?\}\s*\)/g, 
  "res.status(500).send('<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>Error</h2><p class=text-muted>操作失败，请重试</p><a href=/admin class=btn btn-primary>返回后台</a></div></body></html>')"
);
const after = (code.match(/render\('error'/g) || []).length;
fs.writeFileSync('routes/admin.js', code, 'utf8');
console.log(`Done: ${before} -> ${after} error renders remaining`);
