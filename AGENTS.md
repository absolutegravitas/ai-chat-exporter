# AI Chat Exporter - Agent Instructions

A Chrome extension (Manifest V3) that exports Gemini and ChatGPT conversations to Markdown. No build step required.

## Project Overview

- **Type:** Chrome Extension (Manifest V3)
- **Language:** Vanilla JavaScript (ES6+)
- **License:** Apache 2.0
- **No build step** - Load unpacked directly in Chrome

## Commands

```bash
# No build/test commands - this is a pure extension

# To test manually:
# 1. Open chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked" and select this directory

# Create release zip (for distribution)
cd /home/absolutegravitas/Downloads/ai-chat-exporter
mkdir -p dist/src/content_scripts dist/src/lib
cp manifest.json popup.html popup.js dist/
cp -r icons dist/
cp src/content_scripts/gemini.js src/content_scripts/chatgpt.js dist/src/content_scripts/
cp src/lib/turndown.js dist/src/lib/
cd dist && zip -r ../ai-chat-exporter.zip .
```

## File Structure

```
/
├── manifest.json          # Extension manifest (v3)
├── popup.html/js          # Extension popup UI
├── icons/                 # Extension icons (16, 48, 128px)
├── src/
│   ├── content_scripts/
│   │   ├── gemini.js      # Gemini chat extraction
│   │   └── chatgpt.js     # ChatGPT chat extraction
│   └── lib/
│       ├── turndown.js    # HTML-to-Markdown library
│       └── jszip.min.js   # ZIP file creation
└── .github/workflows/     # Release automation
```

## Code Style Guidelines

### JavaScript Conventions

```javascript
// IIFE pattern with strict mode
(function() {
  'use strict';
  // ... code
})();

// CONFIG object for all constants
const CONFIG = {
  BUTTON_ID: 'gemini-export-btn',
  TIMING: { SCROLL_DELAY: 2000 },
  SELECTORS: { CONVERSATION_TURN: 'article[data-testid]' }
};

// Class-based architecture with single responsibility
class ExportService {
  constructor(checkboxManager) {
    this.checkboxManager = checkboxManager;
  }

  async execute(mode, filename) { /* ... */ }
}

// Private methods prefixed with underscore
_buildMarkdownHeader(title) { /* ... */ }
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Classes | PascalCase | `ExportService`, `CheckboxManager` |
| Methods/Functions | camelCase | `handleButtonClick`, `scrollToLoadAll` |
| Constants | SCREAMING_SNAKE_CASE | `BUTTON_ID`, `MAX_SCROLL_ATTEMPTS` |
| Private methods | _underscorePrefix | `_buildMarkdownHeader` |
| CSS classes | kebab-case with prefix | `gemini-export-checkbox` |
| DOM IDs | kebab-case | `chatgpt-export-btn` |

### Imports & Dependencies

- **No module system** - Scripts loaded via manifest.json
- Libraries loaded before content scripts in manifest order
- Chrome APIs accessed via global `chrome` object

```json
// manifest.json - load order matters
"js": ["src/lib/turndown.js", "src/lib/jszip.min.js", "src/content_scripts/gemini.js"]
```

### Async Patterns

```javascript
// Prefer async/await over .then()
async function exportChat() {
  try {
    await ScrollService.loadAllMessages();
    const markdown = await this.buildMarkdown(turns, title);
  } catch (error) {
    console.error('Export error:', error);
    alert(`Export failed: ${error.message}`);
  }
}

// Chrome storage with Promise wrapper
const result = await new Promise((resolve) => {
  chrome.storage.sync.get(['hideExportBtn'], resolve);
});
```

### Error Handling

```javascript
// Always wrap chrome API calls in try-catch
try {
  if (chrome?.storage?.sync) {
    chrome.storage.sync.get(['hideExportBtn'], callback);
  }
} catch (e) {
  console.warn('Failed to access storage:', e);
}

// Use optional chaining for potentially undefined values
const title = document.querySelector('h1')?.textContent?.trim() || '';
```

### DOM Manipulation

```javascript
// Use Object.assign for batch style application
Object.assign(element.style, {
  position: 'fixed',
  top: '80px',
  zIndex: '9999'
});

// Query with fallbacks
const container = document.querySelector(SELECTORS.CHAT_CONTAINER) ||
                  document.querySelector('.fallback-selector');
```

## Architecture Pattern

Each content script follows this structure:

1. **CONFIG** - All constants, selectors, timing values
2. **Utility Classes** - `DateUtils`, `StringUtils`, `DOMUtils`
3. **Service Classes** - `SettingsService`, `AttachmentService`, `ScrollService`
4. **Manager Classes** - `CheckboxManager`, `SelectionManager`
5. **Builder Classes** - `UIBuilder`, `MarkdownConverter`
6. **Controller** - `ExportController` (coordinates everything)
7. **Initialization** - Single controller instantiation at bottom

## Chrome Extension APIs Used

- `chrome.storage.sync` - Persist user preferences
- `chrome.downloads.download` - Download attachments
- `chrome.runtime.lastError` - Error handling
- `navigator.clipboard` - Clipboard operations

## Adding Support for New Chat Platforms

1. Create new file: `src/content_scripts/newplatform.js`
2. Follow existing pattern (CONFIG → Classes → Controller → Init)
3. Define platform-specific selectors in CONFIG
4. Add to manifest.json content_scripts:

```json
{
  "matches": ["https://newplatform.com/*"],
  "js": ["src/content_scripts/newplatform.js"],
  "run_at": "document_idle"
}
```

## Common Gotchas

- **No TypeScript** - Use JSDoc comments if type hints needed
- **Content script isolation** - Each script runs in isolated world
- **DOM changes** - Chat platforms may update DOM; selectors may need maintenance
- **Clipboard permissions** - Required for ChatGPT export mode
- **CORS** - Fetch attachments from content script context (has host permissions)

---

## Session Context (Business Requirements)

### Original User Requests

1. Create a tool to download all chat history from Google Gemini (gemini.google.com) via API
2. Add attachment support - images and files downloaded alongside chat, zipped together
3. Fork amazingpaddy/ai-chat-exporter and add requested features
4. Add donation buttons (Stripe + Airwallex) to extension popup and GitHub README
5. Simplify export flow - remove preference popup, export on single click
6. Add sidebar checkboxes to select multiple chats for batch export
7. Download images/files alongside chat and zip everything into one download

### Final Goal

A Chrome extension that exports Gemini chat conversations with:
- **Single-click export** (no popup/dropdown) - exports immediately on button click
- **Sidebar checkboxes** to select multiple chats from conversation list
- **Images and files** downloaded alongside chat
- **Everything consolidated into a single ZIP file** (chatname.md + attachments/ folder)

### Git Workflow Constraints (CRITICAL)

> **ALL CHANGES TO MAIN. ALL RELEASES TO MAIN, NO PRS, DIRECT PUSH TO MAIN AND BUILD AND RELEASE FROM MAIN**
> 
> **NO FURTHER FEATURE BRANCHES**

- Work directly on `main` branch
- No pull requests - direct commits
- No feature branches
- Release workflow runs on push to main

### Implementation Details

#### Export Flow (Simplified)
1. User clicks "Export Chat" button
2. Extension immediately begins export (no dropdown/preference popup)
3. If sidebar checkboxes are checked, batch export those chats
4. If no sidebar selection, export current chat only
5. All images/files are fetched as blobs
6. ZIP file is created with markdown + attachments/ folder
7. Single ZIP file downloads to user's computer

#### Attachment Detection
```javascript
// Selectors used to find uploaded images
SELECTORS: {
  ATTACHMENT_IMAGE: 'img[data-test-id="uploaded-img"], img.preview-image, img[src*="googleusercontent"]',
  ATTACHMENT_FILE_CHIP: '[data-file-name], [data-file-id], .file-chip, .uploaded-file',
  ATTACHMENT_CONTAINER: '.attachment, .uploaded-media, [data-test-id="attachment"]'
}
```

#### ZIP Structure
```
chatname.zip
├── chatname.md          # Markdown export of conversation
└── attachments/
    ├── image1.jpg       # Uploaded images
    ├── image2.png
    └── document.pdf     # Other uploaded files
```

### Debug Console Logs

When testing, look for these console messages:
```
[AI Chat Exporter] Searching for attachments
[AI Chat Exporter] Found uploaded images: X
[AI Chat Exporter] Fetching attachment: <url>
[AI Chat Exporter] Fetched blob: <size> <type>
[AI Chat Exporter] Downloading ZIP with attachments...
```

### Remaining Issues to Debug

1. **Attachment detection** - Images may not be found in DOM correctly
2. **Attachment fetching** - CORS issues may prevent fetching images from googleusercontent.com
3. **ZIP download** - Currently may only download markdown without attachments
4. **Sidebar checkboxes** - May not appear or work for multi-chat selection

### Donation Links

- **Stripe**: https://buy.stripe.com/placeholder_stripe
- **Airwallex**: https://pay.airwallex.com/placeholder_airwallex

### Version History

| Version | Changes |
|---------|---------|
| 4.0.3 | Added jszip.min.js, googleusercontent.com host permission |
| 4.0.2 | Attachment support, sidebar checkboxes, single-click export |
| 4.0.0 | DOM-based extraction for Gemini (no clipboard dependency) |

### Key Classes

| Class | Responsibility |
|-------|----------------|
| `AttachmentService` | Detects and fetches uploaded images/files |
| `FileExportService` | Creates ZIP with markdown + attachments |
| `ExportController` | Coordinates export flow, handles button clicks |
| `UIBuilder` | Creates UI elements, injects sidebar checkboxes |
| `ExportService` | Builds markdown from conversation turns |

### Testing Checklist

1. [ ] Load extension in Chrome (chrome://extensions → Load unpacked)
2. [ ] Go to gemini.google.com and open a chat with uploaded images
3. [ ] Verify "Export Chat" button appears (top right)
4. [ ] Open DevTools Console (F12)
5. [ ] Click Export button
6. [ ] Check console for `[AI Chat Exporter]` messages
7. [ ] Verify ZIP file downloads (not just .md)
8. [ ] Extract ZIP and verify attachments/ folder contains images
9. [ ] Test sidebar checkboxes for multi-chat selection
