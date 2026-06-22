const fs = require('fs');
const path = require('path');

// Available languages
const LANGUAGES = {
  'zh': { name: '中文', flag: '🇨🇳' },
  'en': { name: 'English', flag: '🇬🇧' },
  'fr': { name: 'Français', flag: '🇫🇷' }
};

// Load translations
const translations = {};
const localesDir = path.join(__dirname, '..', 'locales');

Object.keys(LANGUAGES).forEach(lang => {
  const filePath = path.join(localesDir, `${lang}.json`);
  if (fs.existsSync(filePath)) {
    translations[lang] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
});

// Get nested translation value
function getTranslation(obj, key) {
  const keys = key.split('.');
  let value = obj;
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      return null;
    }
  }
  return value;
}

// i18n middleware
function i18nMiddleware(req, res, next) {
  // Get language from query, session, or accept-language header
  let lang = req.query.lang;
  
  // If lang in query, save to session
  if (lang && LANGUAGES[lang]) {
    if (req.session) {
      req.session.lang = lang;
    }
  } else if (req.session && req.session.lang) {
    // Use saved language from session
    lang = req.session.lang;
  } else if (!lang || !LANGUAGES[lang]) {
    // Try to detect from Accept-Language header
    const acceptLang = req.headers['accept-language'];
    if (acceptLang) {
      const preferred = acceptLang.split(',')[0].split('-')[0].toLowerCase();
      if (LANGUAGES[preferred]) {
        lang = preferred;
      }
    }
  }
  
  // Default to Chinese
  if (!lang || !LANGUAGES[lang]) {
    lang = 'zh';
  }
  
  // Store current language
  req.lang = lang;
  
  // Translation function
  req.t = function(key, ...args) {
    const translation = translations[lang] || translations['zh'];
    let value = getTranslation(translation, key);
    
    if (value === null) {
      // Fallback to Chinese
      value = getTranslation(translations['zh'], key) || key;
    }
    
    // Simple string interpolation
    if (typeof value === 'string' && args.length > 0) {
      args.forEach((arg, i) => {
        value = value.replace(`{${i}}`, arg);
      });
    }
    
    return value;
  };
  
  // Make available to views
  res.locals.lang = lang;
  res.locals.t = req.t;
  res.locals.languages = LANGUAGES;
  res.locals.currentLang = LANGUAGES[lang];
  
  // Generate URL with language
  res.locals.urlWithLang = function(newLang) {
    const url = new URL(req.originalUrl, `http://localhost`);
    url.searchParams.set('lang', newLang);
    // Remove trailing ? if no other params
    const search = url.search;
    return url.pathname + search;
  };
  
  next();
}

module.exports = { i18nMiddleware, LANGUAGES };
