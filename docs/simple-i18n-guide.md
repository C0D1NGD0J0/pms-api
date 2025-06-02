# Simple i18n Setup Guide

## ✅ What's Done

Your language system is now streamlined and simple:

### 📁 File Structure
```
app/shared/languages/
├── locales/
│   ├── en.json          # English translations (single file)
│   └── fr.json          # French translations (single file)
├── i18next.config.ts    # i18next configuration
├── language.service.ts  # Simple language service
├── initialize.ts        # Initialization helper
└── index.ts            # Simple exports
```

### 🚀 Usage

**In Controllers:**
```typescript
import { t } from '@shared/languages';

// Simple dot notation
message: t('auth.errors.unauthorized')
message: t('property.errors.noCsvFileUploaded')  
message: t('property.errors.invalidFormType', { formType })
```

**Language Detection:**
- Query param: `?lang=fr`
- Header: `Accept-Language: fr`
- Default: `en`

## 🔧 Setup Steps

### 1. Initialize Language Service (Required)
Add to your app startup:

```typescript
// In server.ts before starting the server
import { initializeLanguageService } from '@shared/languages';

async function start() {
  // Initialize i18next
  await initializeLanguageService();
  
  // Start server
  app.listen(PORT);
}
```

### 2. Add Middleware (Optional)
If you want automatic language detection:

```typescript
// In app.ts
import { I18nMiddleware } from '@shared/middlewares';

constructor(expressApp, dbService, i18nMiddleware) {
  this.i18nMiddleware = i18nMiddleware;
}

private standardMiddleware(app) {
  // Add early in middleware chain
  app.use(this.i18nMiddleware.detectLanguage);
}
```

### 3. DI Container (Already Done)
Language service is registered in DI container and can be injected into controllers/services.

## 📝 Adding Translations

### Add New Language
1. Create `locales/es.json` (copy from `en.json`)
2. Translate values
3. Update supported languages in `i18next.config.ts`:
   ```typescript
   supportedLngs: ['en', 'fr', 'es']
   ```

### Add New Translation Keys
Just add to the JSON files:
```json
{
  "newFeature": {
    "title": "New Feature",
    "description": "Feature description with {{param}}"
  }
}
```

Use with: `t('newFeature.title')` or `t('newFeature.description', { param: 'value' })`

## 🌍 Language Files

### English (`en.json`)
- All 200+ translations organized by domain
- Uses `{{parameter}}` syntax for interpolation

### French (`fr.json`)  
- Complete French translations
- Same structure as English

### Parameter Interpolation
```typescript
// JSON: "message": "Hello {{name}}, you have {{count}} items"
t('message', { name: 'John', count: 5 })
// Result: "Hello John, you have 5 items"
```

## ✨ Benefits

✅ **Single file per language** - Easy to manage  
✅ **Simple usage** - Just `t('key.path')`  
✅ **i18next powered** - Industry standard  
✅ **Parameter support** - `{{variables}}`  
✅ **DI integrated** - Service injectable  
✅ **Backward compatible** - Existing code works  

That's it! Simple and clean. 🎉