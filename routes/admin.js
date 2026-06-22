const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const https = require('https');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Translate text via DeepL API (fallback to MyMemory free API if DeepL fails)
async function translateText(text, fromLang, toLang) {
  if (!text || !text.trim()) return '';
  const trimmed = text.trim().substring(0, 1000);

  // DeepL language code mapping
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

  // Fallback to MyMemory free API
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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, name);
  }
});

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

// Wrap upload middleware with error handling
function wrapUpload(uploadMiddleware, formType) {
  return (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (err) {
        // 把错误信息存到 session，重定向回表单页
        let msg = '文件上传错误：';
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') msg = '文件过大，单个文件不能超过 100MB';
          else if (err.code === 'LIMIT_FILE_COUNT') msg = '文件数量超出限制（最多9张图片+1个视频）';
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
      return `${isCreate ? req.t('nav.admin') === 'Admin Panel' ? 'Field' : '字段' : '更新车辆时'} ${field} ${req.t('nav.admin') === 'Admin Panel' ? 'is required' : '为必填项'}`;
    }
  }
  return null;
}

function validateMediaCounts(images, videos, existingImages, existingVideos, isCreate, req) {
  const totalImages = (existingImages || 0) + images.length;
  const totalVideos = (existingVideos || 0) + videos.length;
  const isEnglish = req.t('nav.admin') === 'Admin Panel';
  if (isCreate) {
    if (images.length < 9) return isEnglish ? 'Please upload 9 images' : '请上传 9 张图片';
    if (images.length > 9) return isEnglish ? 'Maximum 9 images allowed' : '最多上传 9 张图片';
    if (videos.length !== 1) return isEnglish ? 'Please upload 1 video' : '请上传 1 个视频';
  } else {
    if (totalImages > 9) return isEnglish ? 'Maximum 9 images total' : '图片总数不能超过 9 张';
    if (totalVideos > 1) return isEnglish ? 'Maximum 1 video total' : '视频总数不能超过 1 个';
  }
  return null;
}

function saveMediaFiles(db, carId, files, existingImageCount, existingVideoCount) {
  const { images, videos } = files;
  const coverSet = (db.exec(
    "SELECT COUNT(*) as c FROM car_media WHERE car_id = ? AND is_cover = 1",
    [carId]
  )[0].values[0][0] > 0);
  let sortStart = 0;
  const maxSort = db.exec(
    "SELECT COALESCE(MAX(sort_order), -1) as max FROM car_media WHERE car_id = ?",
    [carId]
  );
  sortStart = maxSort[0].values[0][0] + 1;

  let hasCover = coverSet;
  [...images, ...videos].forEach((file, i) => {
    const isImage = file.mimetype.startsWith('image/');
    const relativePath = '/uploads/' + file.filename;
    let isCover = 0;
    if (!hasCover && isImage) {
      isCover = 1;
      hasCover = true;
    }
    db.run(
      "INSERT INTO car_media (car_id, file_path, file_type, sort_order, is_cover) VALUES (?, ?, ?, ?, ?)",
      [carId, relativePath, isImage ? 'image' : 'video', sortStart + i, isCover]
    );
  });
}

function deleteCarMediaFiles(db, carId) {
  const mediaResult = db.exec("SELECT file_path FROM car_media WHERE car_id = ?", [carId]);
  if (mediaResult.length && mediaResult[0].values.length) {
    for (const val of mediaResult[0].values) {
      const filePath = path.join(__dirname, '..', 'public', val[0]);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }
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
  router.get('/', requireAuth, (req, res) => {
    const userId = req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';

    try {
      let totalCars, activeCars, totalUsers;

      if (isAdmin) {
        totalCars = db.exec("SELECT COUNT(*) as c FROM cars")[0].values[0][0];
        activeCars = db.exec("SELECT COUNT(*) as c FROM cars WHERE status = 'active'")[0].values[0][0];
        totalUsers = db.exec("SELECT COUNT(*) as c FROM users")[0].values[0][0];
      } else {
        totalCars = db.exec("SELECT COUNT(*) as c FROM cars WHERE created_by = ?", [userId])[0].values[0][0];
        activeCars = db.exec("SELECT COUNT(*) as c FROM cars WHERE created_by = ? AND status = 'active'", [userId])[0].values[0][0];
        totalUsers = 0;
      }

      const pendingCars = isAdmin
        ? db.exec("SELECT COUNT(*) as c FROM cars WHERE status = 'pending'")[0].values[0][0]
        : 0;

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
      res.status(500).render('error', {
        title: req.t('error.title'),
        message: '加载失败',
        user: req.session.user,
        lang: req.lang,
        t: req.t
      });
    }
  });

  // Cars list
  router.get('/cars', requireAuth, (req, res) => {
    const userId = req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';

    try {
      let carsResult;
      if (isAdmin) {
        carsResult = db.exec(
          `SELECT c.*, u.display_name as creator_name 
           FROM cars c 
           LEFT JOIN users u ON c.created_by = u.id 
           ORDER BY c.created_at DESC`
        );
      } else {
        carsResult = db.exec(
          `SELECT c.*, u.display_name as creator_name 
           FROM cars c 
           LEFT JOIN users u ON c.created_by = u.id 
           WHERE c.created_by = ?
           ORDER BY c.created_at DESC`,
          [userId]
        );
      }

      const cars = [];
      if (carsResult.length && carsResult[0].values.length) {
        const cols = carsResult[0].columns;
        for (const val of carsResult[0].values) {
          const car = {};
          cols.forEach((col, i) => car[col] = val[i]);
          cars.push(car);
        }
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
      res.status(500).render('error', {
        title: req.t('error.title'),
        message: '加载失败',
        user: req.session.user,
        lang: req.lang,
        t: req.t
      });
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
  router.post('/cars/create', requireAuth, carUploadSafe, (req, res) => {
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

      db.run(
        `INSERT INTO cars (brand, model, year, mileage, price, cost_price, color, fuel_type, transmission, displacement, description, category, status, created_by, contact_wechat, contact_whatsapp, contact_email, translations)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [brand, model, parseInt(year), parseInt(mileage),
         finalPrice, finalCostPrice, color, fuel_type, transmission,
         displacement, description, category, finalStatus, userId,
         isAdmin ? (req.body.contact_wechat || '') : '',
         isAdmin ? (req.body.contact_whatsapp || '') : '',
         isAdmin ? (req.body.contact_email || '') : '',
         JSON.stringify(translations)]
      );

      const carId = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];

      saveMediaFiles(db, carId, files, 0, 0);
      saveDb();
      res.redirect('/admin/cars');
    } catch (err) {
      console.error('Create car error:', err);
      res.render('admin/car-form', {
        title: '添加车辆',
        user: req.session.user,
        car: null,
        error: '添加失败：' + err.message,
        lang: req.lang,
        t: req.t
      });
    }
  });

  // Edit car form
  router.get('/cars/edit/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id);
    const userId = req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';

    try {
      const error = req.session.uploadError || null;
      req.session.uploadError = null;
      const result = db.exec("SELECT * FROM cars WHERE id = ?", [id]);
      if (!result.length || !result[0].values.length) {
        return res.status(404).render('error', {
          title: req.t('error.404'),
          message: '车辆不存在',
          user: req.session.user,
          lang: req.lang,
          t: req.t
        });
      }

      const cols = result[0].columns;
      const vals = result[0].values[0];
      const car = {};
      cols.forEach((col, i) => car[col] = vals[i]);

      if (!isAdmin && car.created_by !== userId) {
        return res.status(403).render('error', {
          title: req.t('error.title'),
          message: '你无权编辑此车辆',
          user: req.session.user,
          lang: req.lang,
          t: req.t
        });
      }

      const mediaResult = db.exec("SELECT * FROM car_media WHERE car_id = ? ORDER BY sort_order", [id]);
      const media = [];
      if (mediaResult.length && mediaResult[0].values.length) {
        const mCols = mediaResult[0].columns;
        for (const val of mediaResult[0].values) {
          const item = {};
          mCols.forEach((col, i) => item[col] = val[i]);
          media.push(item);
        }
      }
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
      res.status(500).render('error', {
        title: req.t('error.title'),
        message: '加载失败',
        user: req.session.user,
        lang: req.lang,
        t: req.t
      });
    }
  });

  // Edit car handler
  router.post('/cars/edit/:id', requireAuth, carEditUploadSafe, (req, res) => {
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
      const checkResult = db.exec("SELECT * FROM cars WHERE id = ?", [id]);
      if (!checkResult.length || !checkResult[0].values.length) {
        return res.status(404).render('error', {
          title: req.t('error.404'),
          message: '车辆不存在',
          user: req.session.user,
          lang: req.lang,
          t: req.t
        });
      }

      const cols = checkResult[0].columns;
      const vals = checkResult[0].values[0];
      const existingCar = {};
      cols.forEach((col, i) => existingCar[col] = vals[i]);

      if (!isAdmin && existingCar.created_by !== userId) {
        return res.status(403).render('error', {
          title: req.t('error.title'),
          message: '权限不足',
          user: req.session.user,
          lang: req.lang,
          t: req.t
        });
      }

      const mediaCount = db.exec("SELECT file_type, COUNT(*) as c FROM car_media WHERE car_id = ? GROUP BY file_type", [id]);
      let existingImages = 0;
      let existingVideos = 0;
      if (mediaCount.length && mediaCount[0].values.length) {
        for (const row of mediaCount[0].values) {
          if (row[0] === 'image') existingImages = row[1];
          if (row[0] === 'video') existingVideos = row[1];
        }
      }

      const newFiles = collectFiles(req, 'new_images', 'new_video');
      const mediaError = validateMediaCounts(newFiles.images, newFiles.videos, existingImages, existingVideos, false, req);
      if (mediaError) {
        const mediaResult = db.exec("SELECT * FROM car_media WHERE car_id = ? ORDER BY sort_order", [id]);
        const media = [];
        if (mediaResult.length && mediaResult[0].values.length) {
          const mCols = mediaResult[0].columns;
          for (const val of mediaResult[0].values) {
            const item = {};
            mCols.forEach((col, i) => item[col] = val[i]);
            media.push(item);
          }
        }
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

      db.run(
        `UPDATE cars SET brand=?, model=?, year=?, mileage=?, price=?, cost_price=?, color=?, fuel_type=?, 
         transmission=?, displacement=?, description=?, category=?, status=?, updated_at=CURRENT_TIMESTAMP,
         contact_wechat=?, contact_whatsapp=?, contact_email=?, translations=?
         WHERE id=?`,
        [brand, model, parseInt(year), parseInt(mileage),
         finalPrice, finalCostPrice, color, fuel_type, transmission,
         displacement, description, category, carStatus,
         contactWechat, contactWhatsapp, contactEmail, JSON.stringify(translations), id]
      );

      saveMediaFiles(db, id, newFiles, existingImages, existingVideos);

      saveDb();
      res.redirect('/admin/cars');
    } catch (err) {
      console.error('Update car error:', err);
      res.status(500).render('error', {
        title: req.t('error.title'),
        message: '更新失败：' + err.message,
        user: req.session.user,
        lang: req.lang,
        t: req.t
      });
    }
  });

  // Review routes (admin only)
  router.get('/review', requireAdmin, (req, res) => {
    try {
      const result = db.exec(
        `SELECT c.*, u.display_name as creator_name 
         FROM cars c 
         LEFT JOIN users u ON c.created_by = u.id 
         WHERE c.status = 'pending'
         ORDER BY c.created_at DESC`
      );

      const cars = [];
      if (result.length && result[0].values.length) {
        const cols = result[0].columns;
        for (const val of result[0].values) {
          const car = {};
          cols.forEach((col, i) => car[col] = val[i]);
          cars.push(car);
        }
      }

      res.render('admin/review-list', {
        title: '审核车辆',
        user: req.session.user,
        cars,
        lang: req.lang,
        t: req.t
      });
    } catch (err) {
      console.error('Review list error:', err);
      res.status(500).render('error', {
        title: req.t('error.title'),
        message: '加载失败',
        user: req.session.user,
        lang: req.lang,
        t: req.t
      });
    }
  });

  router.get('/review/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);

    try {
      const result = db.exec("SELECT * FROM cars WHERE id = ? AND status = 'pending'", [id]);
      if (!result.length || !result[0].values.length) {
        return res.status(404).render('error', {
          title: req.t('error.404'),
          message: '车辆不存在或已审核',
          user: req.session.user,
          lang: req.lang,
          t: req.t
        });
      }

      const cols = result[0].columns;
      const vals = result[0].values[0];
      const car = {};
      cols.forEach((col, i) => car[col] = vals[i]);

      const mediaResult = db.exec("SELECT * FROM car_media WHERE car_id = ? ORDER BY sort_order", [id]);
      const media = [];
      if (mediaResult.length && mediaResult[0].values.length) {
        const mCols = mediaResult[0].columns;
        for (const val of mediaResult[0].values) {
          const item = {};
          mCols.forEach((col, i) => item[col] = val[i]);
          media.push(item);
        }
      }
      car.media = media;

      const creatorResult = db.exec("SELECT display_name FROM users WHERE id = ?", [car.created_by]);
      car.creator_name = creatorResult.length && creatorResult[0].values.length
        ? creatorResult[0].values[0][0]
        : 'Unknown';

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
      res.status(500).render('error', {
        title: req.t('error.title'),
        message: '加载失败',
        user: req.session.user,
        lang: req.lang,
        t: req.t
      });
    }
  });

  router.post('/review/:id', requireAdmin, reviewUploadSafe, (req, res) => {
    const id = parseInt(req.params.id);
    const { price, action } = req.body;

    try {
      const checkResult = db.exec("SELECT * FROM cars WHERE id = ? AND status = 'pending'", [id]);
      if (!checkResult.length || !checkResult[0].values.length) {
        return res.status(404).render('error', {
          title: req.t('error.404'),
          message: '车辆不存在或已审核',
          user: req.session.user,
          lang: req.lang,
          t: req.t
        });
      }

      if (action === 'reject') {
        deleteCarMediaFiles(db, id);
        db.run("DELETE FROM cars WHERE id = ?", [id]);
        saveDb();
        return res.redirect('/admin/review');
      }

      if (!price || price === '' || parseFloat(price) <= 0) {
        return res.redirect('/admin/review/' + id + '?error=' + encodeURIComponent('请填写售价（USD）'));
      }

      const finalPrice = parseFloat(price);
      db.run(
        "UPDATE cars SET price = ?, status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [finalPrice, id]
      );

      const newFiles = collectFiles(req, 'new_images', 'new_video');
      const mediaCount = db.exec("SELECT file_type, COUNT(*) as c FROM car_media WHERE car_id = ? GROUP BY file_type", [id]);
      let existingImages = 0;
      let existingVideos = 0;
      if (mediaCount.length && mediaCount[0].values.length) {
        for (const row of mediaCount[0].values) {
          if (row[0] === 'image') existingImages = row[1];
          if (row[0] === 'video') existingVideos = row[1];
        }
      }
      const mediaError = validateMediaCounts(newFiles.images, newFiles.videos, existingImages, existingVideos, false, req);
      if (!mediaError) {
        saveMediaFiles(db, id, newFiles, existingImages, existingVideos);
      }

      saveDb();
      res.redirect('/admin/review');
    } catch (err) {
      console.error('Review error:', err);
      res.status(500).render('error', {
        title: req.t('error.title'),
        message: '审核失败',
        user: req.session.user,
        lang: req.lang,
        t: req.t
      });
    }
  });

  // Delete media
  router.post('/cars/media/delete/:mediaId', requireAuth, (req, res) => {
    const mediaId = parseInt(req.params.mediaId);
    const userId = req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';

    try {
      const mediaResult = db.exec(
        `SELECT cm.*, c.created_by FROM car_media cm 
         JOIN cars c ON cm.car_id = c.id 
         WHERE cm.id = ?`,
        [mediaId]
      );

      if (!mediaResult.length || !mediaResult[0].values.length) {
        return res.status(404).json({ error: '文件不存在' });
      }

      const mCols = mediaResult[0].columns;
      const mVals = mediaResult[0].values[0];
      const mediaInfo = {};
      mCols.forEach((col, i) => mediaInfo[col] = mVals[i]);

      if (!isAdmin && mediaInfo.created_by !== userId) {
        return res.status(403).json({ error: '权限不足' });
      }

      const filePath = path.join(__dirname, '..', 'public', mediaInfo.file_path);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      db.run("DELETE FROM car_media WHERE id = ?", [mediaId]);
      saveDb();

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete car
  router.post('/cars/delete/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id);
    const userId = req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';

    try {
      const checkResult = db.exec("SELECT created_by FROM cars WHERE id = ?", [id]);
      if (!checkResult.length || !checkResult[0].values.length) {
        return res.status(404).render('error', {
          title: req.t('error.404'),
          message: '车辆不存在',
          user: req.session.user,
          lang: req.lang,
          t: req.t
        });
      }

      if (!isAdmin && checkResult[0].values[0][0] !== userId) {
        return res.status(403).render('error', {
          title: req.t('error.title'),
          message: '权限不足',
          user: req.session.user,
          lang: req.lang,
          t: req.t
        });
      }

      const mediaResult = db.exec("SELECT file_path FROM car_media WHERE car_id = ?", [id]);
      if (mediaResult.length && mediaResult[0].values.length) {
        for (const val of mediaResult[0].values) {
          const filePath = path.join(__dirname, '..', 'public', val[0]);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      }

      db.run("DELETE FROM cars WHERE id = ?", [id]);
      saveDb();

      res.redirect('/admin/cars');
    } catch (err) {
      console.error('Delete car error:', err);
      res.status(500).render('error', {
        title: req.t('error.title'),
        message: '删除失败',
        user: req.session.user,
        lang: req.lang,
        t: req.t
      });
    }
  });

  // User management (admin only)
  router.get('/users', requireAdmin, (req, res) => {
    try {
      const result = db.exec(
        `SELECT u.*, 
         (SELECT COUNT(*) FROM cars WHERE created_by = u.id) as car_count 
         FROM users u ORDER BY u.role, u.created_at DESC`
      );

      const users = [];
      if (result.length && result[0].values.length) {
        const cols = result[0].columns;
        for (const val of result[0].values) {
          const user = {};
          cols.forEach((col, i) => user[col] = val[i]);
          users.push(user);
        }
      }

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
      res.status(500).render('error', {
        title: req.t('error.title'),
        message: '加载失败',
        user: req.session.user,
        lang: req.lang,
        t: req.t
      });
    }
  });

  // Create sub-account
  router.post('/users/create', requireAdmin, async (req, res) => {
    const { username, password, display_name } = req.body;

    if (!username || !password) {
      const result = db.exec("SELECT * FROM users ORDER BY role, created_at DESC");
      const users = [];
      if (result.length && result[0].values.length) {
        const cols = result[0].columns;
        for (const val of result[0].values) {
          const user = {};
          cols.forEach((col, i) => user[col] = val[i]);
          users.push(user);
        }
      }
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
      const existCheck = db.exec("SELECT id FROM users WHERE username = ?", [username]);
      if (existCheck.length && existCheck[0].values.length) {
        const result = db.exec("SELECT * FROM users ORDER BY role, created_at DESC");
        const users = [];
        if (result.length && result[0].values.length) {
          const cols = result[0].columns;
          for (const val of result[0].values) {
            const user = {};
            cols.forEach((col, i) => user[col] = val[i]);
            users.push(user);
          }
        }
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
      db.run(
        "INSERT INTO users (username, password, display_name, role, created_by) VALUES (?, ?, ?, 'sub', ?)",
        [username, hash, display_name || username, req.session.user.id]
      );
      saveDb();

      res.redirect('/admin/users');
    } catch (err) {
      console.error('Create user error:', err);
      res.status(500).render('error', {
        title: req.t('error.title'),
        message: '创建用户失败',
        user: req.session.user,
        lang: req.lang,
        t: req.t
      });
    }
  });

  // Delete sub-account (admin only)
  router.post('/users/delete/:id', requireAdmin, async (req, res) => {
    const userId = parseInt(req.params.id);

    if (userId === req.session.user.id) {
      return res.redirect('/admin/users?error=' + encodeURIComponent('不能删除当前登录的主账号'));
    }

    try {
      const userResult = db.exec("SELECT * FROM users WHERE id = ?", [userId]);
      if (!userResult.length || !userResult[0].values.length) {
        return res.redirect('/admin/users?error=' + encodeURIComponent('用户不存在'));
      }

      const cols = userResult[0].columns;
      const vals = userResult[0].values[0];
      const targetUser = {};
      cols.forEach((col, i) => targetUser[col] = vals[i]);

      if (targetUser.role === 'admin') {
        return res.redirect('/admin/users?error=' + encodeURIComponent('不能删除主账号'));
      }

      // Transfer cars created by this sub-account to the admin
      db.run("UPDATE cars SET created_by = ? WHERE created_by = ?", [req.session.user.id, userId]);

      // Delete the sub-account
      db.run("DELETE FROM users WHERE id = ?", [userId]);
      saveDb();

      res.redirect('/admin/users?success=' + encodeURIComponent('子账号已删除，其车辆已转给主账号'));
    } catch (err) {
      console.error('Delete user error:', err);
      res.redirect('/admin/users?error=' + encodeURIComponent('删除失败：' + err.message));
    }
  });

  // Global settings (admin only)
  router.get('/settings', requireAdmin, (req, res) => {
    try {
      const result = db.exec("SELECT * FROM site_settings WHERE id = 1");
      let settings = { id: 1, contact_wechat: '', contact_whatsapp: '', contact_email: '' };
      if (result.length && result[0].values.length) {
        const cols = result[0].columns;
        const vals = result[0].values[0];
        cols.forEach((col, i) => settings[col] = vals[i]);
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
      res.status(500).render('error', {
        title: req.t('error.title'),
        message: '加载失败',
        user: req.session.user,
        lang: req.lang,
        t: req.t
      });
    }
  });

  router.post('/settings', requireAdmin, (req, res) => {
    const { contact_wechat, contact_whatsapp, contact_email } = req.body;
    try {
      db.run(
        `UPDATE site_settings SET contact_wechat=?, contact_whatsapp=?, contact_email=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=1`,
        [
          (contact_wechat || '').trim(),
          (contact_whatsapp || '').trim(),
          (contact_email || '').trim(),
          req.session.user.id
        ]
      );
      saveDb();
      const savedMsg = req.t && req.t('nav.admin') === 'Admin Panel' ? 'Settings saved successfully' : '设置已保存';
      res.redirect('/admin/settings?success=' + encodeURIComponent(savedMsg));
    } catch (err) {
      console.error('Save settings error:', err);
      res.redirect('/admin/settings?error=' + encodeURIComponent('保存失败：' + err.message));
    }
  });

  // Auto-translate car to all supported languages (async, non-blocking for user)
  router.post('/cars/translate/:id', requireAuth, async (req, res) => {
    const carId = parseInt(req.params.id);
    const userId = req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';
    const supportedLangs = ['en', 'fr'];
    const langNames = { en: '🇬🇧 English', fr: '🇫🇷 Français' };
    const fromLang = req.body.from_lang || 'zh';

    try {
      // Verify ownership
      const ownerResult = db.exec("SELECT created_by FROM cars WHERE id = ?", [carId]);
      if (!ownerResult.length || !ownerResult[0].values.length) {
        return res.redirect('/admin/cars?error=' + encodeURIComponent('车辆不存在'));
      }
      if (!isAdmin && ownerResult[0].values[0][0] !== userId) {
        return res.redirect('/admin/cars?error=' + encodeURIComponent('权限不足'));
      }

      // Get current translations
      const tResult = db.exec(`SELECT translations FROM cars WHERE id = ?`, [carId]);
      let translations = {};
      if (tResult.length && tResult[0].values.length && tResult[0].values[0][0]) {
        try { translations = JSON.parse(tResult[0].values[0][0]); } catch {}
      }

      // Get translatable fields
      const fields = ['brand', 'model', 'description', 'color'];
      const carResult = db.exec(`SELECT ${fields.join(',')} FROM cars WHERE id = ?`, [carId]);
      if (!carResult.length || !carResult[0].values.length) {
        return res.redirect('/admin/cars?error=' + encodeURIComponent('车辆不存在'));
      }
      const cols = carResult[0].columns;
      const vals = carResult[0].values[0];
      const car = {};
      cols.forEach((c, i) => car[c] = vals[i] || '');

      const results = [];
      for (const lang of supportedLangs) {
        translations[lang] = translations[lang] || {};
        for (const field of fields) {
          if (car[field] && car[field].trim()) {
            const result = await translateText(car[field], fromLang, lang);
            translations[lang][field] = result;
            results.push(`${langNames[lang]}: ${car[field]} → ${result}`);
          }
        }
      }

      db.run(`UPDATE cars SET translations = ? WHERE id = ?`, [JSON.stringify(translations), carId]);
      saveDb();

      // Store results in session for display
      req.session.translationResults = results.slice(0, 20);
      res.redirect('/admin/cars/edit/' + carId + '?translated=1&lang=' + encodeURIComponent(req.lang));
    } catch (err) {
      console.error('Translate error:', err);
      res.redirect('/admin/cars?error=' + encodeURIComponent('翻译失败：' + err.message));
    }
  });

  // Translate form fields without saving (used on create page)
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
      res.json({ error: req.t && req.t('nav.admin') === 'Admin Panel' ? 'Translation failed: ' : '翻译失败：' + err.message });
    }
  });

  return router;
};
