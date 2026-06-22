const http = require('http');
http.get('http://localhost:3000/?lang=zh', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('status:', res.statusCode);
    console.log('排量:', d.includes('排量'));
    console.log('伟德车行:', d.includes('伟德车行'));
    console.log('美元:', d.includes('$'));
  });
});
