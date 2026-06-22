# DeepL API 接入完成

## 目标
将用户提供的 DeepL API 接入伟德车行二手车网站，替代/增强原有的 MyMemory 免费翻译，用于自动翻译车源信息（品牌、型号、描述、颜色）到英/法/德/日/韩。

## 关键变更

### 1. API Key 管理
- 已写入 `C:\Users\Administrator\.qclaw\workspace\car-dealer\.env`：
  ```
  DEEPL_API_KEY=***
  ```
  （真实 key 已隐藏，仅通过环境变量读取，代码中无硬编码）
- `app.js` 已加载 `dotenv`，环境变量自动可用。

### 2. 翻译函数改造（routes/admin.js）
- `translateText()` 现在优先调用 DeepL 免费 API (`https://api-free.deepl.com/v2/translate`)。
- 使用 **Header 鉴权**：`Authorization: DeepL-Auth-Key {key}`（DeepL 已废弃 query parameter 传 key）。
- 源语言固定为 `ZH`，目标语言为 `EN/FR/DE/JA/KO`。
- 单次请求最多 1000 字符，超时 15 秒。
- DeepL 失败时自动回退到 MyMemory 免费 API，保证可用性。

### 3. 修复"点击翻译跳出来"问题
**根因**：原翻译按钮的 `<form>` 被嵌套在车辆编辑主表单内部，HTML 不允许嵌套 form。浏览器实际提交的是外层主表单，导致页面"跳走"到保存/编辑路由，而不是执行翻译。

**修复**：
- 重写 `views/admin/car-form.ejs`，将翻译区块移到主表单**外部**，成为独立的 `<form>`。
- 翻译按钮不再与保存/更新按钮冲突。
- 添加按钮 loading 状态（显示"翻译中..."并禁用按钮），避免重复提交。
- 翻译完成后重定向保留当前语言参数 `?lang=xxx`，防止页面语言被重置。

### 4. 前台翻译生效逻辑
- `routes/public.js` 中 `applyTranslations()` 在列表页和详情页渲染前，根据当前语言从 `cars.translations` JSON 字段读取并覆盖 brand/model/description/color。
- 无翻译时自动降级显示中文。

## 验证结果
- 用临时脚本测试 DeepL API：HTTP 200，翻译成功。
- 示例：`2025款长安糯玉米，301公里续航，跑了1.4万公里` → `2025 Changan Sweet Corn, 301-kilometer range, has driven 14,000 kilometers`。
- 服务器已重启，新代码生效。

## 使用方法
1. 进入后台 `/admin/cars/{id}/edit`
2. 拉到页面底部"自动翻译"黄色卡片
3. 点击"一键翻译为5种语言"
4. 等待约 3-8 秒（DeepL 5 次请求），页面会重定向回编辑页并显示翻译摘要
5. 前台切换语言后，车辆卡片和详情页自动显示对应翻译

## 文件变更
- `C:\Users\Administrator\.qclaw\workspace\car-dealer\.env`
- `C:\Users\Administrator\.qclaw\workspace\car-dealer\routes\admin.js`
- `C:\Users\Administrator\.qclaw\workspace\car-dealer\views\admin\car-form.ejs`
- `C:\Users\Administrator\.qclaw\workspace\car-dealer\routes\public.js`（已有 applyTranslations）
