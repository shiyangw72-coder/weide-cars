const express = require('express');
const router = express.Router();

module.exports = function(db, saveDb) {

  // Apply translations to a car object based on current language
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

  router.get('/', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const brand = req.query.brand || '';
    const category = req.query.category || '';

    let whereClause = "WHERE c.status = 'active'";
    let paramIdx = 1;
    const params = [];

    if (search) {
      whereClause += ` AND (c.brand LIKE $${paramIdx} OR c.model LIKE $${paramIdx+1} OR c.description LIKE $${paramIdx+2})`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      paramIdx += 3;
    }
    if (brand) {
      whereClause += ` AND c.brand = $${paramIdx}`;
      params.push(brand);
      paramIdx++;
    }
    if (category) {
      whereClause += ` AND c.category = $${paramIdx}`;
      params.push(category);
      paramIdx++;
    }

    try {
      const countResult = await db.queryOne(
        `SELECT COUNT(*) as total FROM cars c ${whereClause}`,
        params
      );
      const total = parseInt(countResult.total);

      const cars = await db.query(
        `SELECT c.*, u.display_name as creator_name 
         FROM cars c 
         LEFT JOIN users u ON c.created_by = u.id 
         ${whereClause} 
         ORDER BY c.created_at DESC 
         LIMIT $${paramIdx} OFFSET $${paramIdx+1}`,
        [...params, limit, offset]
      );

      for (const car of cars) {
        const coverMedia = await db.queryOne(
          "SELECT file_path FROM car_media WHERE car_id = $1 AND is_cover = 1 LIMIT 1",
          [car.id]
        );
        if (coverMedia) {
          car.cover_image = coverMedia.file_path;
        } else {
          const imgMedia = await db.queryOne(
            "SELECT file_path FROM car_media WHERE car_id = $1 AND file_type = 'image' LIMIT 1",
            [car.id]
          );
          car.cover_image = imgMedia ? imgMedia.file_path : null;
        }
      }

      const brands = await db.query(
        "SELECT DISTINCT brand FROM cars WHERE status = 'active' AND brand != '' ORDER BY brand"
      );
      const categories = await db.query(
        "SELECT DISTINCT category FROM cars WHERE status = 'active' AND category != '' ORDER BY category"
      );

      const totalPages = Math.ceil(total / limit);

      // Load global site contact settings
      let siteContacts = { contact_wechat: '', contact_whatsapp: '', contact_email: '' };
      try {
        const settings = await db.queryOne("SELECT contact_wechat, contact_whatsapp, contact_email FROM site_settings WHERE id = 1");
        if (settings) {
          siteContacts = settings;
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
        brands: brands.map(b => b.brand),
        currentPage: page,
        totalPages,
        search,
        selectedBrand: brand,
        selectedCategory: category,
        categories: categories.map(c => c.category),
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

  router.get('/car/:id', async (req, res) => {
    const id = parseInt(req.params.id);

    try {
      const car = await db.queryOne(
        `SELECT c.*, u.display_name as creator_name 
         FROM cars c 
         LEFT JOIN users u ON c.created_by = u.id 
         WHERE c.id = $1`,
        [id]
      );

      if (!car) {
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

      const media = await db.query(
        "SELECT * FROM car_media WHERE car_id = $1 ORDER BY sort_order ASC, id ASC",
        [id]
      );

      // Load global site contacts
      let siteContacts = { contact_wechat: '', contact_whatsapp: '', contact_email: '' };
      try {
        const settings = await db.queryOne("SELECT contact_wechat, contact_whatsapp, contact_email FROM site_settings WHERE id = 1");
        if (settings) siteContacts = settings;
      } catch (e) {}

      applyTranslations(car, req.lang);

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
