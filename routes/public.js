const express = require('express');
const router = express.Router();

module.exports = function(db, saveDb) {

  // Apply translations to a car object based on current language
  // fields: brand, model, description, color
  function applyTranslations(car, lang) {
    if (!car || !car.translations || lang === 'zh') return car;
    try {
      const t = typeof car.translations === 'string'
        ? JSON.parse(car.translations)
        : car.translations;
      const tl = t[lang];
      if (!tl) return car;
      if (tl.brand) car.brand = tl.brand;
      if (tl.model) car.model = tl.model;
      if (tl.description) car.description = tl.description;
      if (tl.color) car.color = tl.color;
    } catch (e) {}
    return car;
  }

  router.get('/', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const brand = req.query.brand || '';
    const category = req.query.category || '';

    let whereClause = "WHERE c.status = 'active'";
    let params = [];

    if (search) {
      whereClause += " AND (c.brand LIKE ? OR c.model LIKE ? OR c.description LIKE ?)";
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (brand) {
      whereClause += " AND c.brand = ?";
      params.push(brand);
    }
    if (category) {
      whereClause += " AND c.category = ?";
      params.push(category);
    }

    try {
      const countResult = db.exec(
        `SELECT COUNT(*) as total FROM cars c ${whereClause}`,
        params.length ? params : undefined
      );
      const total = countResult[0].values[0][0];

      params.push(limit, offset);
      const carsResult = db.exec(
        `SELECT c.*, u.display_name as creator_name 
         FROM cars c 
         LEFT JOIN users u ON c.created_by = u.id 
         ${whereClause} 
         ORDER BY c.created_at DESC 
         LIMIT ? OFFSET ?`,
        params
      );

      const cars = [];
      if (carsResult.length && carsResult[0].values.length) {
        const cols = carsResult[0].columns;
        for (const val of carsResult[0].values) {
          const car = {};
          cols.forEach((col, i) => car[col] = val[i]);
          cars.push(car);
        }
      }

      for (const car of cars) {
        const mediaResult = db.exec(
          "SELECT file_path, file_type FROM car_media WHERE car_id = ? AND is_cover = 1 LIMIT 1",
          [car.id]
        );
        if (mediaResult.length && mediaResult[0].values.length) {
          car.cover_image = mediaResult[0].values[0][0];
        } else {
          const imgResult = db.exec(
            "SELECT file_path FROM car_media WHERE car_id = ? AND file_type = 'image' LIMIT 1",
            [car.id]
          );
          car.cover_image = imgResult.length && imgResult[0].values.length ? imgResult[0].values[0][0] : null;
        }
      }

      const brandsResult = db.exec(
        "SELECT DISTINCT brand FROM cars WHERE status = 'active' AND brand != '' ORDER BY brand"
      );
      const brands = [];
      if (brandsResult.length && brandsResult[0].values.length) {
        for (const val of brandsResult[0].values) {
          brands.push(val[0]);
        }
      }

      const categoriesResult = db.exec(
        "SELECT DISTINCT category FROM cars WHERE status = 'active' AND category != '' ORDER BY category"
      );
      const categories = [];
      if (categoriesResult.length && categoriesResult[0].values.length) {
        for (const val of categoriesResult[0].values) {
          categories.push(val[0]);
        }
      }

      const totalPages = Math.ceil(total / limit);

      // Load global site contact settings
      let siteContacts = {};
      try {
        const settingsResult = db.exec("SELECT contact_wechat, contact_whatsapp, contact_email FROM site_settings WHERE id = 1");
        if (settingsResult.length && settingsResult[0].values.length) {
          const cols = settingsResult[0].columns;
          const vals = settingsResult[0].values[0];
          cols.forEach((col, i) => siteContacts[col] = vals[i] || '');
        }
      } catch (e) {}

      // Apply translations to each car
      const currentLang = req.lang;
      for (const car of cars) {
        applyTranslations(car, currentLang);
      }

      res.render('index', {
        title: req.t('hero.title'),
        cars,
        brands,
        currentPage: page,
        totalPages,
        search,
        selectedBrand: brand,
        selectedCategory: category,
        categories,
        user: req.session.user || null,
        lang: req.lang,
        t: req.t,
        languages: res.locals.languages,
        currentLang: res.locals.currentLang,
        urlWithLang: res.locals.urlWithLang,
        siteContacts
      });
    } catch (err) {
      console.error('Error loading cars:', err);
      res.status(500).render('error', {
        title: req.t('error.title'),
        message: '加载车辆信息失败',
        user: req.session.user || null,
        lang: req.lang,
        t: req.t,
        languages: res.locals.languages,
        currentLang: res.locals.currentLang,
        urlWithLang: res.locals.urlWithLang
      });
    }
  });

  router.get('/car/:id', (req, res) => {
    const id = parseInt(req.params.id);

    try {
      const result = db.exec(
        `SELECT c.*, u.display_name as creator_name 
         FROM cars c 
         LEFT JOIN users u ON c.created_by = u.id 
         WHERE c.id = ?`,
        [id]
      );

      if (!result.length || !result[0].values.length) {
        return res.status(404).render('error', {
          title: req.t('error.404'),
          message: '该车辆信息不存在',
          user: req.session.user || null,
          lang: req.lang,
          t: req.t,
          languages: res.locals.languages,
          currentLang: res.locals.currentLang,
          urlWithLang: res.locals.urlWithLang
        });
      }

      const cols = result[0].columns;
      const vals = result[0].values[0];
      const car = {};
      cols.forEach((col, i) => car[col] = vals[i]);

      // Only active cars are visible to the public
      if (car.status !== 'active') {
        return res.status(404).render('error', {
          title: req.t('error.404'),
          message: '该车辆信息不存在',
          user: req.session.user || null,
          lang: req.lang,
          t: req.t,
          languages: res.locals.languages,
          currentLang: res.locals.currentLang,
          urlWithLang: res.locals.urlWithLang
        });
      }

      const mediaResult = db.exec(
        "SELECT * FROM car_media WHERE car_id = ? ORDER BY sort_order ASC, id ASC",
        [id]
      );
      const media = [];
      if (mediaResult.length && mediaResult[0].values.length) {
        const mCols = mediaResult[0].columns;
        for (const val of mediaResult[0].values) {
          const item = {};
          mCols.forEach((col, i) => item[col] = val[i]);
          media.push(item);
        }
      }

      // Load global site contacts (fallback if car has no contacts)
      let siteContacts = {};
      try {
        const settingsResult = db.exec("SELECT contact_wechat, contact_whatsapp, contact_email FROM site_settings WHERE id = 1");
        if (settingsResult.length && settingsResult[0].values.length) {
          const cols = settingsResult[0].columns;
          const vals = settingsResult[0].values[0];
          cols.forEach((col, i) => siteContacts[col] = vals[i] || '');
        }
      } catch (e) {}

      // Apply translations based on selected language
      applyTranslations(car, req.lang);

      // If car has no contact info, show global contacts
      if (!car.contact_wechat && !car.contact_whatsapp && !car.contact_email) {
        car.contact_wechat = siteContacts.contact_wechat || '';
        car.contact_whatsapp = siteContacts.contact_whatsapp || '';
        car.contact_email = siteContacts.contact_email || '';
      }

      res.render('car-detail', {
        title: `${car.brand} ${car.model}`,
        car,
        media,
        user: req.session.user || null,
        lang: req.lang,
        t: req.t,
        languages: res.locals.languages,
        currentLang: res.locals.currentLang,
        urlWithLang: res.locals.urlWithLang
      });
    } catch (err) {
      console.error('Error loading car detail:', err);
      res.status(500).render('error', {
        title: req.t('error.title'),
        message: '加载车辆详情失败',
        user: req.session.user || null,
        lang: req.lang,
        t: req.t,
        languages: res.locals.languages,
        currentLang: res.locals.currentLang,
        urlWithLang: res.locals.urlWithLang
      });
    }
  });

  return router;
};
