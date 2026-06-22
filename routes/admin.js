const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const https = require('https');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Translate text via DeepL API (fallback to MyMemory free API if DeepL fails)
async function translateText(text, fromLang, toLang) {
  if (!text || !text.trim()) return '';
  const trimmed = text.trim().substring(0, 1000);

  const targetLang = toLang.toUpperCase();
  const sourceLang = fromLang.toUpperCase() === 'ZH' ? 'ZH' : fromLang.toUpperCase();

  const apiKey = process.env.DEEPL_API_KEY;
  if (apiKey) {
    try {
      const url = `https://api-free.deepl.com/v2/translate?text=${encodeURIComponent(trimmed)}&source_lang=${sourceLang}&target_lang=${targetLang}`;
      const result = await new Promise((resolve, reject) => {
        https.get(url, {
          timeout: 15000,
          headers: { 'Authorization': `DeepL-Auth-Key ${apiKey}` }
        }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject(new Error(`DeepL HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
              return;
            }
            try {
              const json = JSON.parse(data);
              if (json.translations && json.translations[0]) {
                resolve(json.translations[0].text);
              } else {
                reject(new Error('DeepL response missing translations'));
              }
            } catch (err) {
              reject(err);
            }
          });
        }).on('error', reject);
      });
      return result;
    } catch (err) {
      console.error('DeepL error, falling back to MyMemory:', err.message);
    }
  }

  return new Promise((resolve) => {
    const langpair = `${fromLang}|${toLang}`;
    const qs = new URLSearchParams({ q: trimmed.substring(0, 500), langpair });
    const url = `https://api.mymemory.translated.net/get?${qs}`;
    https.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.responseStatus === 200 ? json.responseData.translatedText : trimmed);
        } catch { resolve(trimmed); }
      });
    }).on('error', () => resolve(trimmed));
  });
}

// Memory storage - files remain in buffer, stored to DB as base64
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedImages = /\.(jpg|jpeg|png|gif|webp)$/i;
  const allowedVideos = /\.(mp4|mov|avi|mkv|webm)$/i;
  if (allowedImages.test(file.originalname) || allowedVideos.test(file.originalname)) {
    cb(null, true);
  } else {
    cb(new Error(req.t ? req.t('nav.login') === 'Login' ? 'Only images and videos allowed' : '仅支持图片和视频格式' : '仅支持图片和视频格式'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 }
});

const carUpload = upload.fields([
  { name: 'images', maxCount: 9 },
  { name: 'video', maxCount: 1 }
]);

const carEditUpload = upload.fields([
  { name: 'new_images', maxCount: 9 },
  { name: 'new_video', maxCount: 1 }
]);

const reviewUpload = upload.fields([
  { name: 'new_images', maxCount: 9 },
  { name: 'new_video', maxCount: 1 }
]);

function wrapUpload(uploadMiddleware, formType) {
  return (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (err) {
        let msg = '文件上传错误�?;
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') msg = '文件过大，单个文件不能超�?100MB';
          else if (err.code === 'LIMIT_FILE_COUNT') msg = '文件数量超出限制（最�?张图�?1个视频）';
          else if (err.code === 'LIMIT_FIELD_KEY') msg = '表单字段过多';
          else msg += err.message;
        } else {
          msg += err.message;
        }
        req.session.uploadError = msg;
        if (formType === 'edit' && req.params.id) {
          return res.redirect('/admin/cars/edit/' + req.params.id + '?lang=' + (req.lang || 'zh'));
        }
        if (formType === 'review') {
          return res.redirect('/admin/review?lang=' + (req.lang || 'zh'));
        }
        return res.redirect('/admin/cars/create?lang=' + (req.lang || 'zh'));
      }
      next();
    });
  };
}

const carUploadSafe = wrapUpload(carUpload, 'create');
const carEditUploadSafe = wrapUpload(carEditUpload, 'edit');
const reviewUploadSafe = wrapUpload(reviewUpload, 'review');

function collectFiles(req, imageField, videoField) {
  const images = [];
  const videos = [];
  if (req.files && req.files[imageField]) {
    req.files[imageField].forEach(f => images.push(f));
  }
  if (req.files && req.files[videoField]) {
    req.files[videoField].forEach(f => videos.push(f));
  }
  return { images, videos };
}

function validateCarFields(body, isCreate, req) {
  const required = ['brand', 'model', 'year', 'mileage', 'cost_price', 'color', 'fuel_type', 'transmission', 'category', 'displacement', 'description'];
  for (const field of required) {
    if (!body[field] || String(body[field]).trim() === '') {
      return `${isCreate ? req.t('nav.admin') === 'Admin Panel' ? 'Field' : '字段' : '更新车辆�?} ${field} ${req.t('nav.admin') === 'Admin Panel' ? 'is required' : '为必填项'}`;
    }
  }
  return null;
}

function validateMediaCounts(images, videos, existingImages, existingVideos, isCreate, req) {
  const totalImages = (existingImages || 0) + images.length;
  const totalVideos = (existingVideos || 0) + videos.length;
  const isEnglish = req.t('nav.admin') === 'Admin Panel';
  if (totalImages > 9) return isEnglish ? 'Maximum 9 images total' : '图片总数不能超过 9 �?;
  if (totalVideos > 1) return isEnglish ? 'Maximum 1 video total' : '视频总数不能超过 1 �?;
  if (isCreate && images.length === 0 && videos.length === 0) {
    return isEnglish ? 'Please upload at least one image or video' : '请至少上传一张图片或视频';
  }
  return null;
}

async function saveMediaFiles(db, carId, files, existingImageCount, existingVideoCount) {
  const { images, videos } = files;
  const coverCheck = await db.queryOne(
    "SELECT COUNT(*) as c FROM car_media WHERE car_id = $1 AND is_cover = 1",
    [carId]
  );
  const coverSet = parseInt(coverCheck.c) > 0;

  const maxSort = await db.queryOne(
    "SELECT COALESCE(MAX(sort_order), -1) as max_sort FROM car_media WHERE car_id = $1",
    [carId]
  );
  let sortStart = maxSort.max_sort + 1;

  let hasCover = coverSet;
  const allFiles = [...images, ...videos];
  for (let i = 0; i < allFiles.length; i++) {
    const file = allFiles[i];
    const isImage = file.mimetype.startsWith('image/');
    const base64Data = file.buffer ? file.buffer.toString('base64') : null;
    let isCover = 0;
    if (!hasCover && isImage) {
      isCover = 1;
      hasCover = true;
    }
    await db.execute(
      "INSERT INTO car_media (car_id, file_path, file_data, mime_type, file_type, sort_order, is_cover) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [carId, '', base64Data, file.mimetype, isImage ? 'image' : 'video', sortStart + i, isCover]
    );
  }
}

async function deleteCarMediaFiles(db, carId) {
  // No filesystem cleanup needed - data is stored in DB
  // DELETE is handled by CASCADE on car deletion
}

function buildTranslations(body) {
  const translations = {};
  const fields = ['brand', 'model', 'color', 'description'];
  for (const lang of ['en', 'fr']) {
    translations[lang] = {};
    for (const field of fields) {
      const key = `trans_${lang}_${field}`;
      if (body[key] && body[key].trim()) {
        translations[lang][field] = body[key].trim();
      }
    }
  }
  return translations;
}

module.exports = function(db, saveDb) {

  // Admin dashboard
  router.get('/', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';

    try {
      let totalCars, activeCars, totalUsers, pendingCars = 0;

      if (isAdmin) {
        const tc = await db.queryOne("SELECT COUNT(*) as c FROM cars");
        totalCars = parseInt(tc.c);
        const ac = await db.queryOne("SELECT COUNT(*) as c FROM cars WHERE status = 'active'");
        activeCars = parseInt(ac.c);
        const tu = await db.queryOne("SELECT COUNT(*) as c FROM users");
        totalUsers = parseInt(tu.c);
        const pc = await db.queryOne("SELECT COUNT(*) as c FROM cars WHERE status = 'pending'");
        pendingCars = parseInt(pc.c);
      } else {
        const tc = await db.queryOne("SELECT COUNT(*) as c FROM cars WHERE created_by = $1", [userId]);
        totalCars = parseInt(tc.c);
        const ac = await db.queryOne("SELECT COUNT(*) as c FROM cars WHERE created_by = $1 AND status = 'active'", [userId]);
        activeCars = parseInt(ac.c);
        totalUsers = 0;
      }

      res.render('admin/dashboard', {
        title: req.t('nav.admin'),
        user: req.session.user,
        totalCars,
        activeCars,
        pendingCars,
        totalUsers,
        lang: req.lang,
        t: req.t
      });
    } catch (err) {
      console.error('Dashboard error:', err);
      res.status(`500).send(`<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>?? Error</h2><p class=text-muted>`加载失败</p><a href=/admin class=btn btn-primary>���غ�̨</a></div></body></html>`);
    }
  });

  // Cars list
  router.get('/cars', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';

    try {
      let cars;
      if (isAdmin) {
        cars = await db.query(
          `SELECT c.*, u.display_name as creator_name 
           FROM cars c 
           LEFT JOIN users u ON c.created_by = u.id 
           ORDER BY c.created_at DESC`
        );
      } else {
        cars = await db.query(
          `SELECT c.*, u.display_name as creator_name 
           FROM cars c 
           LEFT JOIN users u ON c.created_by = u.id 
           WHERE c.created_by = $1
           ORDER BY c.created_at DESC`,
          [userId]
        );
      }

      res.render('admin/cars', {
        title: '车辆管理',
        user: req.session.user,
        cars,
        lang: req.lang,
        t: req.t
      });
    } catch (err) {
      console.error('Cars list error:', err);
      res.status(`500).send(`<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>?? Error</h2><p class=text-muted>`加载失败</p><a href=/admin class=btn btn-primary>���غ�̨</a></div></body></html>`);
    }
  });

  // Add car form
  router.get('/cars/create', requireAuth, (req, res) => {
    const error = req.session.uploadError || null;
    req.session.uploadError = null;
    res.render('admin/car-form', {
      title: '添加车辆',
      user: req.session.user,
      car: null,
      error: error,
      lang: req.lang,
      t: req.t
    });
  });

  // Add car handler
  router.post('/cars/create', requireAuth, carUploadSafe, async (req, res) => {
    const { brand, model, year, mileage, price, cost_price, color, fuel_type, transmission, displacement, description, category } = req.body;
    const userId = req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';

    const files = collectFiles(req, 'images', 'video');
    const validationError = validateCarFields(req.body, true, req) || validateMediaCounts(files.images, files.videos, 0, 0, true, req);

    if (validationError) {
      return res.render('admin/car-form', {
        title: '添加车辆',
        user: req.session.user,
        car: null,
        error: validationError,
        lang: req.lang,
        t: req.t
      });
    }

    try {
      const finalPrice = isAdmin ? (price ? parseFloat(price) : null) : null;
      const finalCostPrice = cost_price ? parseFloat(cost_price) : null;
      const finalStatus = isAdmin ? 'active' : 'pending';
      const translations = buildTranslations(req.body);

      const result = await db.execute(
        `INSERT INTO cars (brand, model, year, mileage, price, cost_price, color, fuel_type, transmission, displacement, description, category, status, created_by, contact_wechat, contact_whatsapp, contact_email, translations)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING id`,
        [brand, model, parseInt(year), parseInt(mileage),
         finalPrice, finalCostPrice, color, fuel_type, transmission,
         displacement, description, category, finalStatus, userId,
         isAdmin ? (req.body.contact_wechat || '') : '',
         isAdmin ? (req.body.contact_whatsapp || '') : '',
         isAdmin ? (req.body.contact_email || '') : '',
         JSON.stringify(translations)]
      );

      const carId = result.rows[0].id;

      await saveMediaFiles(db, carId, files, 0, 0);
      res.redirect('/admin/cars');
    } catch (err) {
      console.error('Create car error:', err);
      res.render('admin/car-form', {
        title: '添加车辆',
        user: req.session.user,
        car: null,
        error: '添加失败�? + err.message,
        lang: req.lang,
        t: req.t
      });
    }
  });

  // Edit car form
  router.get('/cars/edit/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const userId = req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';

    try {
      const error = req.session.uploadError || null;
      req.session.uploadError = null;

      const car = await db.queryOne("SELECT * FROM cars WHERE id = $1", [id]);
      if (!car) {
        return res.status(500).send('<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>Error</h2><p class=text-muted>操作失败，请重试</p><a href=/admin class=btn btn-primary>返回后台</a></div></body></html>');
      }

      if (!isAdmin && car.created_by !== userId) {
        return res.status(`403).send(`<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>?? Error</h2><p class=text-muted>`你无权编辑此车辆</p><a href=/admin class=btn btn-primary>���غ�̨</a></div></body></html>`);
      }

      const media = await db.query("SELECT * FROM car_media WHERE car_id = $1 ORDER BY sort_order", [id]);
      car.media = media;

      const translationResults = req.session.translationResults || null;
      if (req.session.translationResults) req.session.translationResults = null;

      res.render('admin/car-form', {
        title: '编辑车辆',
        user: req.session.user,
        car,
        error: error,
        translationResults,
        lang: req.lang,
        t: req.t
      });
    } catch (err) {
      console.error('Edit car error:', err);
      res.status(`500).send(`<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>?? Error</h2><p class=text-muted>`加载失败</p><a href=/admin class=btn btn-primary>���غ�̨</a></div></body></html>`);
    }
  });

  // Edit car handler
  router.post('/cars/edit/:id', requireAuth, carEditUploadSafe, async (req, res) => {
    const id = parseInt(req.params.id);
    const userId = req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';
    const { brand, model, year, mileage, price, cost_price, color, fuel_type, transmission, displacement, description, status, category } = req.body;

    const validationError = validateCarFields(req.body, false, req);
    if (validationError) {
      return res.render('admin/car-form', {
        title: '编辑车辆',
        user: req.session.user,
        car: { ...req.body, id, media: [] },
        error: validationError,
        lang: req.lang,
        t: req.t
      });
    }

    try {
      const existingCar = await db.queryOne("SELECT * FROM cars WHERE id = $1", [id]);
      if (!existingCar) {
        return res.status(500).send('<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>Error</h2><p class=text-muted>操作失败，请重试</p><a href=/admin class=btn btn-primary>返回后台</a></div></body></html>');
      }

      if (!isAdmin && existingCar.created_by !== userId) {
        return res.status(`403).send(`<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>?? Error</h2><p class=text-muted>`权限不足</p><a href=/admin class=btn btn-primary>���غ�̨</a></div></body></html>`);
      }

      const mediaCounts = await db.query("SELECT file_type, COUNT(*) as c FROM car_media WHERE car_id = $1 GROUP BY file_type", [id]);
      let existingImages = 0;
      let existingVideos = 0;
      for (const row of mediaCounts) {
        if (row.file_type === 'image') existingImages = parseInt(row.c);
        if (row.file_type === 'video') existingVideos = parseInt(row.c);
      }

      const newFiles = collectFiles(req, 'new_images', 'new_video');
      const mediaError = validateMediaCounts(newFiles.images, newFiles.videos, existingImages, existingVideos, false, req);
      if (mediaError) {
        const media = await db.query("SELECT * FROM car_media WHERE car_id = $1 ORDER BY sort_order", [id]);
        existingCar.media = media;
        return res.render('admin/car-form', {
          title: '编辑车辆',
          user: req.session.user,
          car: existingCar,
          error: mediaError,
          lang: req.lang,
          t: req.t
        });
      }

      const carStatus = isAdmin ? (status || existingCar.status) : existingCar.status;
      const finalPrice = isAdmin ? (price ? parseFloat(price) : existingCar.price) : existingCar.price;
      const finalCostPrice = cost_price ? parseFloat(cost_price) : existingCar.cost_price;
      const translations = buildTranslations(req.body);

      const contactWechat = isAdmin ? (req.body.contact_wechat || '') : (existingCar.contact_wechat || '');
      const contactWhatsapp = isAdmin ? (req.body.contact_whatsapp || '') : (existingCar.contact_whatsapp || '');
      const contactEmail = isAdmin ? (req.body.contact_email || '') : (existingCar.contact_email || '');

      await db.execute(
        `UPDATE cars SET brand=$1, model=$2, year=$3, mileage=$4, price=$5, cost_price=$6, color=$7, fuel_type=$8, 
         transmission=$9, displacement=$10, description=$11, category=$12, status=$13, updated_at=CURRENT_TIMESTAMP,
         contact_wechat=$14, contact_whatsapp=$15, contact_email=$16, translations=$17
         WHERE id=$18`,
        [brand, model, parseInt(year), parseInt(mileage),
         finalPrice, finalCostPrice, color, fuel_type, transmission,
         displacement, description, category, carStatus,
         contactWechat, contactWhatsapp, contactEmail, JSON.stringify(translations), id]
      );

      await saveMediaFiles(db, id, newFiles, existingImages, existingVideos);

      res.redirect('/admin/cars');
    } catch (err) {
      console.error('Update car error:', err);
      res.status(500).send('<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>Error</h2><p class=text-muted>操作失败，请重试</p><a href=/admin class=btn btn-primary>返回后台</a></div></body></html>');
    }
  });

  // Review routes (admin only)
  router.get('/review', requireAdmin, async (req, res) => {
    try {
      const cars = await db.query(
        `SELECT c.*, u.display_name as creator_name 
         FROM cars c 
         LEFT JOIN users u ON c.created_by = u.id 
         WHERE c.status = 'pending'
         ORDER BY c.created_at DESC`
      );

      res.render('admin/review-list', {
        title: '审核车辆',
        user: req.session.user,
        cars,
        lang: req.lang,
        t: req.t
      });
    } catch (err) {
      console.error('Review list error:', err);
      res.status(`500).send(`<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>?? Error</h2><p class=text-muted>`加载失败</p><a href=/admin class=btn btn-primary>���غ�̨</a></div></body></html>`);
    }
  });

  router.get('/review/:id', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);

    try {
      const car = await db.queryOne("SELECT * FROM cars WHERE id = $1 AND status = 'pending'", [id]);
      if (!car) {
        return res.status(500).send('<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>Error</h2><p class=text-muted>操作失败，请重试</p><a href=/admin class=btn btn-primary>返回后台</a></div></body></html>');
      }

      const media = await db.query("SELECT * FROM car_media WHERE car_id = $1 ORDER BY sort_order", [id]);
      car.media = media;

      const creator = await db.queryOne("SELECT display_name FROM users WHERE id = $1", [car.created_by]);
      car.creator_name = creator ? creator.display_name : 'Unknown';

      res.render('admin/review-form', {
        title: '审核车辆',
        user: req.session.user,
        car,
        error: null,
        lang: req.lang,
        t: req.t
      });
    } catch (err) {
      console.error('Review form error:', err);
      res.status(`500).send(`<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>?? Error</h2><p class=text-muted>`加载失败</p><a href=/admin class=btn btn-primary>���غ�̨</a></div></body></html>`);
    }
  });

  router.post('/review/:id', requireAdmin, reviewUploadSafe, async (req, res) => {
    const id = parseInt(req.params.id);
    const { price, action } = req.body;

    try {
      const checkCar = await db.queryOne("SELECT * FROM cars WHERE id = $1 AND status = 'pending'", [id]);
      if (!checkCar) {
        return res.status(500).send('<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>Error</h2><p class=text-muted>操作失败，请重试</p><a href=/admin class=btn btn-primary>返回后台</a></div></body></html>');
      }

      if (action === 'reject') {
        await deleteCarMediaFiles(db, id);
        await db.execute("DELETE FROM cars WHERE id = $1", [id]);
        return res.redirect('/admin/review');
      }

      if (!price || price === '' || parseFloat(price) <= 0) {
        return res.redirect('/admin/review/' + id + '?error=' + encodeURIComponent('请填写售价（USD�?));
      }

      const finalPrice = parseFloat(price);
      await db.execute(
        "UPDATE cars SET price = $1, status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [finalPrice, id]
      );

      const newFiles = collectFiles(req, 'new_images', 'new_video');
      const mediaCounts = await db.query("SELECT file_type, COUNT(*) as c FROM car_media WHERE car_id = $1 GROUP BY file_type", [id]);
      let existingImages = 0;
      let existingVideos = 0;
      for (const row of mediaCounts) {
        if (row.file_type === 'image') existingImages = parseInt(row.c);
        if (row.file_type === 'video') existingVideos = parseInt(row.c);
      }
      const mediaError = validateMediaCounts(newFiles.images, newFiles.videos, existingImages, existingVideos, false, req);
      if (!mediaError) {
        await saveMediaFiles(db, id, newFiles, existingImages, existingVideos);
      }

      res.redirect('/admin/review');
    } catch (err) {
      console.error('Review error:', err);
      res.status(`500).send(`<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>?? Error</h2><p class=text-muted>`审核失败</p><a href=/admin class=btn btn-primary>���غ�̨</a></div></body></html>`);
    }
  });

  // Delete media
  router.post('/cars/media/delete/:mediaId', requireAuth, async (req, res) => {
    const mediaId = parseInt(req.params.mediaId);
    const userId = req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';

    try {
      const mediaInfo = await db.queryOne(
        `SELECT cm.*, c.created_by FROM car_media cm 
         JOIN cars c ON cm.car_id = c.id 
         WHERE cm.id = $1`,
        [mediaId]
      );

      if (!mediaInfo) {
        return res.status(404).json({ error: '文件不存�? });
      }

      if (!isAdmin && mediaInfo.created_by !== userId) {
        return res.status(403).json({ error: '权限不足' });
      }

      // No filesystem cleanup needed - data stored in DB
      await db.execute("DELETE FROM car_media WHERE id = $1", [mediaId]);

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete car
  router.post('/cars/delete/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const userId = req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';

    try {
      const checkCar = await db.queryOne("SELECT created_by FROM cars WHERE id = $1", [id]);
      if (!checkCar) {
        return res.status(500).send('<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>Error</h2><p class=text-muted>操作失败，请重试</p><a href=/admin class=btn btn-primary>返回后台</a></div></body></html>');
      }

      if (!isAdmin && checkCar.created_by !== userId) {
        return res.status(`403).send(`<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>?? Error</h2><p class=text-muted>`权限不足</p><a href=/admin class=btn btn-primary>���غ�̨</a></div></body></html>`);
      }

      // No filesystem cleanup needed - data stored in PG database
      await db.execute("DELETE FROM cars WHERE id = $1", [id]);

      res.redirect('/admin/cars');
    } catch (err) {
      console.error('Delete car error:', err);
      res.status(`500).send(`<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>?? Error</h2><p class=text-muted>`删除失败</p><a href=/admin class=btn btn-primary>���غ�̨</a></div></body></html>`);
    }
  });

  // User management (admin only)
  router.get('/users', requireAdmin, async (req, res) => {
    try {
      const users = await db.query(
        `SELECT u.*, 
         (SELECT COUNT(*) FROM cars WHERE created_by = u.id) as car_count 
         FROM users u ORDER BY u.role, u.created_at DESC`
      );

      res.render('admin/users', {
        title: '用户管理',
        user: req.session.user,
        users,
        error: null,
        success: null,
        lang: req.lang,
        t: req.t
      });
    } catch (err) {
      console.error('Users list error:', err);
      res.status(`500).send(`<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>?? Error</h2><p class=text-muted>`加载失败</p><a href=/admin class=btn btn-primary>���غ�̨</a></div></body></html>`);
    }
  });

  // Create sub-account
  router.post('/users/create', requireAdmin, async (req, res) => {
    const { username, password, display_name } = req.body;

    if (!username || !password) {
      const users = await db.query("SELECT * FROM users ORDER BY role, created_at DESC");
      return res.render('admin/users', {
        title: '用户管理',
        user: req.session.user,
        users,
        error: req.t ? req.t('nav.login') === 'Login' ? 'Username and password required' : '用户名和密码不能为空' : '用户名和密码不能为空',
        success: null,
        lang: req.lang,
        t: req.t
      });
    }

    try {
      const existUser = await db.queryOne("SELECT id FROM users WHERE username = $1", [username]);
      if (existUser) {
        const users = await db.query("SELECT * FROM users ORDER BY role, created_at DESC");
        return res.render('admin/users', {
          title: '用户管理',
          user: req.session.user,
          users,
          error: req.t ? req.t('nav.login') === 'Login' ? 'Username already exists' : '用户名已存在' : '用户名已存在',
          success: null,
          lang: req.lang,
          t: req.t
        });
      }

      const hash = await bcrypt.hash(password, 10);
      await db.execute(
        "INSERT INTO users (username, password, display_name, role, created_by) VALUES ($1, $2, $3, 'sub', $4)",
        [username, hash, display_name || username, req.session.user.id]
      );

      res.redirect('/admin/users');
    } catch (err) {
      console.error('Create user error:', err);
      res.status(`500).send(`<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>?? Error</h2><p class=text-muted>`创建用户失败</p><a href=/admin class=btn btn-primary>���غ�̨</a></div></body></html>`);
    }
  });

  // Delete sub-account
  router.post('/users/delete/:id', requireAdmin, async (req, res) => {
    const userId = parseInt(req.params.id);

    if (userId === req.session.user.id) {
      return res.redirect('/admin/users?error=' + encodeURIComponent('不能删除当前登录的主账号'));
    }

    try {
      const targetUser = await db.queryOne("SELECT * FROM users WHERE id = $1", [userId]);
      if (!targetUser) {
        return res.redirect('/admin/users?error=' + encodeURIComponent('用户不存�?));
      }

      if (targetUser.role === 'admin') {
        return res.redirect('/admin/users?error=' + encodeURIComponent('不能删除主账�?));
      }

      // Transfer cars to admin
      await db.execute("UPDATE cars SET created_by = $1 WHERE created_by = $2", [req.session.user.id, userId]);
      // Delete the sub-account
      await db.execute("DELETE FROM users WHERE id = $1", [userId]);

      res.redirect('/admin/users?success=' + encodeURIComponent('子账号已删除，其车辆已转给主账号'));
    } catch (err) {
      console.error('Delete user error:', err);
      res.redirect('/admin/users?error=' + encodeURIComponent('删除失败�? + err.message));
    }
  });

  // Global settings
  router.get('/settings', requireAdmin, async (req, res) => {
    try {
      let settings = await db.queryOne("SELECT * FROM site_settings WHERE id = 1");
      if (!settings) {
        settings = { id: 1, contact_wechat: '', contact_whatsapp: '', contact_email: '' };
      }
      res.render('admin/settings', {
        title: '网站设置',
        user: req.session.user,
        settings,
        error: req.query.error || null,
        success: req.query.success || null,
        lang: req.lang,
        t: req.t
      });
    } catch (err) {
      console.error('Settings error:', err);
      res.status(`500).send(`<html><head><meta charset=utf-8><title>Error</title><link href=https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css rel=stylesheet></head><body class=bg-light><div class=container py-5 text-center><h2>?? Error</h2><p class=text-muted>`加载失败</p><a href=/admin class=btn btn-primary>���غ�̨</a></div></body></html>`);
    }
  });

  router.post('/settings', requireAdmin, async (req, res) => {
    const { contact_wechat, contact_whatsapp, contact_email } = req.body;
    try {
      await db.execute(
        `UPDATE site_settings SET contact_wechat=$1, contact_whatsapp=$2, contact_email=$3, updated_by=$4, updated_at=CURRENT_TIMESTAMP WHERE id=1`,
        [
          (contact_wechat || '').trim(),
          (contact_whatsapp || '').trim(),
          (contact_email || '').trim(),
          req.session.user.id
        ]
      );
      const savedMsg = req.t && req.t('nav.admin') === 'Admin Panel' ? 'Settings saved successfully' : '设置已保�?;
      res.redirect('/admin/settings?success=' + encodeURIComponent(savedMsg));
    } catch (err) {
      console.error('Save settings error:', err);
      res.redirect('/admin/settings?error=' + encodeURIComponent('保存失败�? + err.message));
    }
  });

  // Auto-translate car
  router.post('/cars/translate/:id', requireAuth, async (req, res) => {
    const carId = parseInt(req.params.id);
    const userId = req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';
    const supportedLangs = ['en', 'fr'];
    const langNames = { en: '🇬🇧 English', fr: '🇫🇷 Français' };
    const fromLang = req.body.from_lang || 'zh';

    try {
      const ownerCheck = await db.queryOne("SELECT created_by FROM cars WHERE id = $1", [carId]);
      if (!ownerCheck) {
        return res.redirect('/admin/cars?error=' + encodeURIComponent('车辆不存�?));
      }
      if (!isAdmin && ownerCheck.created_by !== userId) {
        return res.redirect('/admin/cars?error=' + encodeURIComponent('权限不足'));
      }

      const tResult = await db.queryOne("SELECT translations FROM cars WHERE id = $1", [carId]);
      let translations = {};
      if (tResult && tResult.translations) {
        try { translations = typeof tResult.translations === 'string' ? JSON.parse(tResult.translations) : tResult.translations; } catch {}
      }

      const fields = ['brand', 'model', 'description', 'color'];
      const car = await db.queryOne(`SELECT ${fields.join(',')} FROM cars WHERE id = $1`, [carId]);
      if (!car) {
        return res.redirect('/admin/cars?error=' + encodeURIComponent('车辆不存�?));
      }

      const results = [];
      for (const lang of supportedLangs) {
        translations[lang] = translations[lang] || {};
        for (const field of fields) {
          if (car[field] && car[field].trim()) {
            const result = await translateText(car[field], fromLang, lang);
            translations[lang][field] = result;
            results.push(`${langNames[lang]}: ${car[field]} �?${result}`);
          }
        }
      }

      await db.execute(`UPDATE cars SET translations = $1 WHERE id = $2`, [JSON.stringify(translations), carId]);

      req.session.translationResults = results.slice(0, 20);
      res.redirect('/admin/cars/edit/' + carId + '?translated=1&lang=' + encodeURIComponent(req.lang));
    } catch (err) {
      console.error('Translate error:', err);
      res.redirect('/admin/cars?error=' + encodeURIComponent('翻译失败�? + err.message));
    }
  });

  // Translate form fields (AJAX)
  router.post('/cars/translate-fields', requireAuth, async (req, res) => {
    const { brand, model, color, description, from_lang } = req.body;
    const supportedLangs = ['en', 'fr'];
    const fromLang = from_lang || 'zh';

    if (!brand || !model || !description) {
      return res.json({ error: req.t && req.t('nav.admin') === 'Admin Panel' ? 'Brand, model and description are required' : '品牌、型号和描述不能为空' });
    }

    try {
      const fields = ['brand', 'model', 'color', 'description'];
      const input = { brand, model, color, description };
      const translations = {};

      for (const lang of supportedLangs) {
        translations[lang] = {};
        for (const field of fields) {
          if (input[field] && input[field].trim()) {
            translations[lang][field] = await translateText(input[field], fromLang, lang);
          }
        }
      }

      res.json({ translations });
    } catch (err) {
      console.error('Translate fields error:', err);
      res.json({ error: req.t && req.t('nav.admin') === 'Admin Panel' ? 'Translation failed: ' : '翻译失败�? + err.message });
    }
  });

  return router;
};
