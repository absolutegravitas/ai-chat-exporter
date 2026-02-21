/**
 * Gemini Chat Exporter - Gemini content script
 * Exports Gemini chat conversations to Markdown with LaTeX preservation
 * Version 4.0.0 - DOM-based extraction (no clipboard dependency)
 */

(function() {
  'use strict';

  const CONFIG = {
    BUTTON_ID: 'gemini-export-btn',
    DROPDOWN_ID: 'gemini-export-dropdown',
    FILENAME_INPUT_ID: 'gemini-filename-input',
    SELECT_DROPDOWN_ID: 'gemini-select-dropdown',
    CHECKBOX_CLASS: 'gemini-export-checkbox',
    EXPORT_MODE_NAME: 'gemini-export-mode',
    
    SELECTORS: {
      CHAT_CONTAINER: '[data-test-id="chat-history-container"]',
      CONVERSATION_TURN: 'div.conversation-container',
      USER_QUERY: 'user-query',
      USER_QUERY_TEXT: '.query-text .query-text-line',
      MODEL_RESPONSE: 'model-response',
      MODEL_RESPONSE_CONTENT: 'message-content .markdown',
      CONVERSATION_TITLE: '.conversation-title',
      
      USER_QUERY_CONTAINER: 'user-query, [data-testid="user-query"], [role="textbox"]',
      
      ATTACHMENT_IMAGE: 'img[src], img[data-src], .uploaded-image img, [data-uploaded-image] img, img.ql-upload, img[data-file-id]',
      ATTACHMENT_FILE_CHIP: '[data-file-name], [data-file-id], .file-chip, .uploaded-file, [data-testid="file-chip"], [aria-label*="file"]',
      ATTACHMENT_CONTAINER: '.attachment, .uploaded-media, [data-test-id="attachment"], [data-testid="file-attachment"], .file-attachment'
    },
    
    TIMING: {
      SCROLL_DELAY: 2000,
      POPUP_DURATION: 900,
      NOTIFICATION_CLEANUP_DELAY: 1000,
      MAX_SCROLL_ATTEMPTS: 60,
      MAX_STABLE_SCROLLS: 4
    },
    
    STYLES: {
      BUTTON_PRIMARY: '#1a73e8',
      BUTTON_HOVER: '#1765c1',
      DARK_BG: '#111',
      DARK_TEXT: '#fff',
      DARK_BORDER: '#444',
      LIGHT_BG: '#fff',
      LIGHT_TEXT: '#222',
      LIGHT_BORDER: '#ccc'
    },
    
    MATH_BLOCK_SELECTOR: '.math-block[data-math]',
    MATH_INLINE_SELECTOR: '.math-inline[data-math]',
    
    DEFAULT_FILENAME: 'gemini_chat_export',
    MARKDOWN_HEADER: '# Gemini Chat Export',
    EXPORT_TIMESTAMP_FORMAT: 'Exported on:',
    
    STORAGE_KEYS: {
      EXPORT_MODE: 'exportMode',
      INCLUDE_ATTACHMENTS: 'includeAttachments',
      CUSTOM_FILENAME: 'customFilename',
      MESSAGE_SELECTION: 'messageSelection'
    }
  };

  // ============================================================================
  // SETTINGS SERVICE - Persist user preferences
  // ============================================================================
  
  class SettingsService {
    static async save(settings) {
      try {
        if (chrome?.storage?.sync) {
          await new Promise((resolve) => {
            chrome.storage.sync.set(settings, resolve);
          });
        }
      } catch (e) {
        console.warn('Failed to save settings:', e);
      }
    }

    static async load() {
      try {
        if (chrome?.storage?.sync) {
          return await new Promise((resolve) => {
            chrome.storage.sync.get([
              CONFIG.STORAGE_KEYS.EXPORT_MODE,
              CONFIG.STORAGE_KEYS.INCLUDE_ATTACHMENTS,
              CONFIG.STORAGE_KEYS.CUSTOM_FILENAME,
              CONFIG.STORAGE_KEYS.MESSAGE_SELECTION
            ], resolve);
          });
        }
      } catch (e) {
        console.warn('Failed to load settings:', e);
      }
      return {};
    }

    static getDefaults() {
      return {
        [CONFIG.STORAGE_KEYS.EXPORT_MODE]: 'file',
        [CONFIG.STORAGE_KEYS.INCLUDE_ATTACHMENTS]: true,
        [CONFIG.STORAGE_KEYS.CUSTOM_FILENAME]: '',
        [CONFIG.STORAGE_KEYS.MESSAGE_SELECTION]: 'all'
      };
    }
  }

  // ============================================================================
  // UTILITY SERVICES
  // ============================================================================
  
  class DateUtils {
    static getDateString() {
      const d = new Date();
      const pad = n => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    }

    static getLocaleString() {
      return new Date().toLocaleString();
    }
  }

  class StringUtils {
    static sanitizeFilename(text) {
      return text
        .replace(/[\\/:*?"<>|.]/g, '')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '');
    }

    static removeCitations(text) {
      return text
        .replace(/\[cite_start\]/g, '')
        .replace(/\[cite:[\d,\s]+\]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }
  }

  class AttachmentService {
    constructor() {
      this.attachments = [];
      this.baseUrl = window.location.origin;
    }

    findUserAttachments(userQueryElement) {
      if (!userQueryElement) return [];
      
      const attachments = [];
      const seen = new Set();
      
      console.log('[AI Chat Exporter] Searching for attachments in element:', userQueryElement);
      
      const allImages = userQueryElement.querySelectorAll('img');
      console.log('[AI Chat Exporter] Found images:', allImages.length);
      
      allImages.forEach((img, index) => {
        if (!img.src || img.src === '' || img.src === 'data:') return;
        if (img.src.includes('logo') || img.src.includes('icon') || img.src.includes('spinner')) return;
        
        const src = img.src.startsWith('data:') ? img.src : 
          (img.src.startsWith('http') ? img.src : this.baseUrl + img.src);
        
        if (!seen.has(src)) {
          seen.add(src);
          const name = img.alt || `image_${index + 1}`;
          attachments.push({
            type: 'image',
            src: src,
            name: name,
            index: index,
            element: img
          });
          console.log('[AI Chat Exporter] Found image:', src.substring(0, 50));
        }
      });

      const fileChips = userQueryElement.querySelectorAll('[data-file-name], [data-file-id], [data-testid*="file"]');
      fileChips.forEach((chip, index) => {
        const fileName = chip.getAttribute('data-file-name') || 
                         chip.getAttribute('data-file-id') ||
                         chip.getAttribute('data-testid') ||
                         chip.textContent?.trim() || 
                         chip.getAttribute('aria-label') ||
                         `uploaded_file_${index + 1}`;
        
        const key = fileName + '_file';
        if (!seen.has(key)) {
          seen.add(key);
          attachments.push({
            type: 'file',
            name: fileName,
            index: index,
            element: chip
          });
          console.log('[AI Chat Exporter] Found file chip:', fileName);
        }
      });

      console.log('[AI Chat Exporter] Total attachments found:', attachments.length);
      return attachments;
    }

    async imageToBase64(url) {
      try {
        if (url.startsWith('data:')) {
          return url;
        }
        
        const response = await fetch(url);
        const blob = await response.blob();
        
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      } catch (error) {
        console.warn('Failed to convert image to Base64:', url, error);
        return null;
      }
    }

    async downloadFile(url, filename, exportFolder) {
      try {
        const attachmentFilename = `${exportFolder}/attachments/${filename}`;
        
        if (url.startsWith('data:')) {
          const response = await fetch(url);
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          
          return new Promise((resolve) => {
            chrome.downloads.download({
              url: blobUrl,
              filename: attachmentFilename,
              saveAs: false
            }, (downloadId) => {
              if (chrome.runtime.lastError) {
                console.warn('Download failed:', chrome.runtime.lastError);
                resolve(null);
              } else {
                resolve(attachmentFilename);
              }
            });
          });
        } else {
          return new Promise((resolve) => {
            chrome.downloads.download({
              url: url,
              filename: attachmentFilename,
              saveAs: false
            }, (downloadId) => {
              if (chrome.runtime.lastError) {
                console.warn('Download failed:', chrome.runtime.lastError);
                resolve(null);
              } else {
                resolve(attachmentFilename);
              }
            });
          });
        }
      } catch (error) {
        console.warn('Failed to download file:', filename, error);
        return null;
      }
    }

    getFileExtension(filename) {
      const parts = filename.split('.');
      return parts.length > 1 ? parts.pop().toLowerCase() : '';
    }

    isImageExtension(ext) {
      return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'tif'].includes(ext);
    }

    sanitizeFilename(name) {
      return name.replace(/[^a-zA-Z0-9._-]/g, '_');
    }
  }

  class DOMUtils {
    static sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    static isDarkMode() {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    static createNotification(message) {
      const popup = document.createElement('div');
      Object.assign(popup.style, {
        position: 'fixed',
        top: '24px',
        right: '24px',
        zIndex: '99999',
        background: '#333',
        color: '#fff',
        padding: '10px 18px',
        borderRadius: '8px',
        fontSize: '1em',
        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        opacity: '0.95',
        pointerEvents: 'none'
      });
      popup.textContent = message;
      document.body.appendChild(popup);
      setTimeout(() => popup.remove(), CONFIG.TIMING.POPUP_DURATION);
      return popup;
    }
  }

  // ============================================================================
  // FILENAME SERVICE
  // ============================================================================
  
  class FilenameService {
    static getConversationTitle() {
      const titleCard = document.querySelector(CONFIG.SELECTORS.CONVERSATION_TITLE);
      return titleCard ? titleCard.textContent.trim() : '';
    }

    static generate(customFilename, conversationTitle) {
      // Priority: custom > conversation title > page title > timestamp
      if (customFilename && customFilename.trim()) {
        const base = this._sanitizeCustomFilename(customFilename);
        return base || `${CONFIG.DEFAULT_FILENAME}_${DateUtils.getDateString()}`;
      }

      // Try conversation title first
      if (conversationTitle) {
        const safeTitle = StringUtils.sanitizeFilename(conversationTitle);
        if (safeTitle) return `${safeTitle}_${DateUtils.getDateString()}`;
      }

      // Fallback to page title
      const pageTitle = document.querySelector('title')?.textContent.trim();
      if (pageTitle) {
        const safeTitle = StringUtils.sanitizeFilename(pageTitle);
        if (safeTitle) return `${safeTitle}_${DateUtils.getDateString()}`;
      }

      // Final fallback
      return `${CONFIG.DEFAULT_FILENAME}_${DateUtils.getDateString()}`;
    }

    static _sanitizeCustomFilename(filename) {
      let base = filename.trim().replace(/\.[^/.]+$/, '');
      return base.replace(/[^a-zA-Z0-9_\-]/g, '_');
    }
  }

  // ============================================================================
  // SCROLL SERVICE
  // ============================================================================
  
  class ScrollService {
    static async loadAllMessages() {
      const scrollContainer = document.querySelector(CONFIG.SELECTORS.CHAT_CONTAINER);
      if (!scrollContainer) {
        throw new Error('Could not find chat history container. Are you on a Gemini chat page?');
      }

      let stableScrolls = 0;
      let scrollAttempts = 0;
      let lastScrollTop = null;

      while (stableScrolls < CONFIG.TIMING.MAX_STABLE_SCROLLS && 
             scrollAttempts < CONFIG.TIMING.MAX_SCROLL_ATTEMPTS) {
        const currentTurnCount = document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN).length;
        scrollContainer.scrollTop = 0;
        await DOMUtils.sleep(CONFIG.TIMING.SCROLL_DELAY);
        
        const scrollTop = scrollContainer.scrollTop;
        const newTurnCount = document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN).length;
        
        if (newTurnCount === currentTurnCount && (lastScrollTop === scrollTop || scrollTop === 0)) {
          stableScrolls++;
        } else {
          stableScrolls = 0;
        }
        
        lastScrollTop = scrollTop;
        scrollAttempts++;
      }
    }
  }

  // ============================================================================
  // FILE EXPORT SERVICE
  // ============================================================================
  
  class FileExportService {
    static downloadMarkdown(markdown, filenameBase) {
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filenameBase}.md`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, CONFIG.TIMING.NOTIFICATION_CLEANUP_DELAY);
    }

    static async exportToClipboard(markdown) {
      await navigator.clipboard.writeText(markdown);
      alert('Conversation copied to clipboard!');
    }
  }

  // ============================================================================
  // MARKDOWN CONVERTER SERVICE
  // ============================================================================
  
  class MarkdownConverter {
    constructor() {
      this.turndownService = this._createTurndownService();
    }

    _createTurndownService() {
      if (typeof window.TurndownService !== 'function') {
        return null;
      }

      const service = new window.TurndownService({
        codeBlockStyle: 'fenced',
        emDelimiter: '*',
        strongDelimiter: '**',
        headingStyle: 'atx',
        hr: '---',
        bulletListMarker: '-',
        codeBlockFence: '```'
      });

      service.addRule('mathBlock', {
        filter: node => node.nodeType === 1 && node.matches?.(CONFIG.MATH_BLOCK_SELECTOR),
        replacement: (content, node) => {
          const latex = node.getAttribute('data-math') || '';
          return `$$${latex}$$\n\n`;
        }
      });

      service.addRule('mathInline', {
        filter: node => node.nodeType === 1 && node.matches?.(CONFIG.MATH_INLINE_SELECTOR),
        replacement: (content, node) => {
          const latex = node.getAttribute('data-math') || '';
          return `$${latex}$`;
        }
      });

      service.addRule('table', {
        filter: 'table',
        replacement: (content, node) => {
          const rows = Array.from(node.querySelectorAll('tr'));
          if (!rows.length) return '';

          const getCells = row => {
            return Array.from(row.querySelectorAll('th, td')).map(cell => {
              const cellContent = service.turndown(cell.innerHTML);
              return cellContent.replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim();
            });
          };

          const headerRow = rows[0];
          const headers = getCells(headerRow);
          const separator = headers.map(() => '---');
          const bodyRows = rows.slice(1).map(getCells);

          const lines = [
            `| ${headers.join(' | ')} |`,
            `| ${separator.join(' | ')} |`,
            ...bodyRows.map(cells => `| ${cells.join(' | ')} |`)
          ];

          return `\n${lines.join('\n')}\n\n`;
        }
      });

      service.addRule('lineBreak', {
        filter: 'br',
        replacement: () => '  \n'
      });

      return service;
    }

    extractUserQuery(userQueryElement) {
      if (!userQueryElement) return '';
      
      const queryLines = userQueryElement.querySelectorAll(CONFIG.SELECTORS.USER_QUERY_TEXT);
      if (queryLines.length === 0) {
        const queryText = userQueryElement.querySelector('.query-text, .user-query-container');
        return queryText ? queryText.textContent.trim() : '';
      }
      
      return Array.from(queryLines)
        .map(line => line.textContent.trim())
        .filter(text => text.length > 0)
        .join('\n');
    }

    extractModelResponse(modelResponseElement) {
      if (!modelResponseElement) return '';
      
      const markdownContainer = modelResponseElement.querySelector(CONFIG.SELECTORS.MODEL_RESPONSE_CONTENT);
      if (!markdownContainer) return '';

      let result = '';
      if (this.turndownService) {
        result = this.turndownService.turndown(markdownContainer.innerHTML);
      } else {
        result = FallbackConverter.convertToMarkdown(markdownContainer);
      }
      
      // Remove Gemini citation markers
      return StringUtils.removeCitations(result);
    }
  }

  // ============================================================================
  // FALLBACK CONVERTER (when Turndown unavailable)
  // ============================================================================
  
  class FallbackConverter {
    static convertToMarkdown(container) {
      return Array.from(container.childNodes).map(node => this._blockText(node)).join('');
    }

    static _inlineText(node) {
      if (!node) return '';
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';

      if (node.nodeType !== Node.ELEMENT_NODE) return '';

      const el = node;
      if (el.matches?.(CONFIG.MATH_INLINE_SELECTOR)) {
        const latex = el.getAttribute('data-math') || '';
        return `$${latex}$`;
      }

      const tag = el.tagName.toLowerCase();
      if (tag === 'br') return '\n';
      if (tag === 'b' || tag === 'strong') {
        return `**${Array.from(el.childNodes).map(n => this._inlineText(n)).join('')}**`;
      }
      if (tag === 'i' || tag === 'em') {
        return `*${Array.from(el.childNodes).map(n => this._inlineText(n)).join('')}*`;
      }
      if (tag === 'code') {
        return `\`${el.textContent || ''}\``;
      }

      return Array.from(el.childNodes).map(n => this._inlineText(n)).join('');
    }

    static _blockText(el) {
      if (!el) return '';

      if (el.nodeType === Node.TEXT_NODE) {
        return (el.textContent || '').trim();
      }

      if (el.nodeType !== Node.ELEMENT_NODE) return '';

      const tag = el.tagName.toLowerCase();

      if (el.matches?.(CONFIG.MATH_BLOCK_SELECTOR)) {
        const latex = el.getAttribute('data-math') || '';
        return `$$${latex}$$\n\n`;
      }

      const handlers = {
        h1: () => `# ${this._inlineText(el)}\n\n`,
        h2: () => `## ${this._inlineText(el)}\n\n`,
        h3: () => `### ${this._inlineText(el)}\n\n`,
        h4: () => `#### ${this._inlineText(el)}\n\n`,
        h5: () => `##### ${this._inlineText(el)}\n\n`,
        h6: () => `###### ${this._inlineText(el)}\n\n`,
        p: () => `${this._inlineText(el)}\n\n`,
        hr: () => `---\n\n`,
        blockquote: () => this._convertBlockquote(el),
        pre: () => `\`\`\`\n${el.textContent || ''}\n\`\`\`\n\n`,
        ul: () => this._convertList(el, false),
        ol: () => this._convertList(el, true),
        table: () => this._convertTable(el)
      };

      if (handlers[tag]) {
        return handlers[tag]();
      }

      // Default: process child nodes
      return Array.from(el.childNodes).map(n => this._blockText(n)).join('');
    }

    static _convertBlockquote(el) {
      const lines = Array.from(el.childNodes).map(n => this._blockText(n)).join('').trim().split('\n');
      return lines.map(line => line ? `> ${line}` : '>').join('\n') + '\n\n';
    }

    static _convertList(el, isOrdered) {
      const items = Array.from(el.querySelectorAll(':scope > li'));
      const converted = items.map((li, i) => {
        const marker = isOrdered ? `${i + 1}.` : '-';
        return `${marker} ${this._inlineText(li).trim()}`;
      }).join('\n');
      return `${converted}\n\n`;
    }

    static _convertTable(el) {
      const rows = Array.from(el.querySelectorAll('tr'));
      if (!rows.length) return '';
      
      const getCells = row => Array.from(row.querySelectorAll('th,td'))
        .map(cell => this._inlineText(cell).replace(/\n/g, ' ').trim());
      
      const header = getCells(rows[0]);
      const separator = header.map(() => '---');
      const body = rows.slice(1).map(getCells);
      
      const lines = [
        `| ${header.join(' | ')} |`,
        `| ${separator.join(' | ')} |`,
        ...body.map(r => `| ${r.join(' | ')} |`)
      ];
      return `${lines.join('\n')}\n\n`;
    }
  }

  // ============================================================================
  // CHECKBOX MANAGER
  // ============================================================================
  class CheckboxManager {
    createCheckbox(type, container) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = CONFIG.CHECKBOX_CLASS;
      cb.checked = true;
      cb.title = `Include this ${type} message in export`;
      
      Object.assign(cb.style, {
        position: 'absolute',
        right: '28px',
        top: '8px',
        zIndex: '10000',
        transform: 'scale(1.2)'
      });
      
      container.style.position = 'relative';
      container.appendChild(cb);
      return cb;
    }

    injectCheckboxes() {
      const turns = document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN);
      
      turns.forEach(turn => {
        // User query checkbox
        const userQueryElem = turn.querySelector(CONFIG.SELECTORS.USER_QUERY);
        if (userQueryElem && !userQueryElem.querySelector(`.${CONFIG.CHECKBOX_CLASS}`)) {
          this.createCheckbox('user', userQueryElem);
        }
        
        // Model response checkbox
        const modelRespElem = turn.querySelector(CONFIG.SELECTORS.MODEL_RESPONSE);
        if (modelRespElem && !modelRespElem.querySelector(`.${CONFIG.CHECKBOX_CLASS}`)) {
          this.createCheckbox('Gemini', modelRespElem);
        }
      });
    }

    removeAll() {
      document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}`).forEach(cb => cb.remove());
    }

    hasAnyChecked() {
      return Array.from(document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}`))
        .some(cb => cb.checked);
    }
  }

  // ============================================================================
  // SELECTION MANAGER
  // ============================================================================
  class SelectionManager {
    constructor(checkboxManager) {
      this.checkboxManager = checkboxManager;
      this.lastSelection = 'all';
    }

    applySelection(value) {
      const checkboxes = document.querySelectorAll(`.${CONFIG.CHECKBOX_CLASS}`);
      
      switch(value) {
        case 'all':
          checkboxes.forEach(cb => cb.checked = true);
          break;
        case 'ai':
          document.querySelectorAll(`${CONFIG.SELECTORS.USER_QUERY} .${CONFIG.CHECKBOX_CLASS}`)
            .forEach(cb => cb.checked = false);
          document.querySelectorAll(`${CONFIG.SELECTORS.MODEL_RESPONSE} .${CONFIG.CHECKBOX_CLASS}`)
            .forEach(cb => cb.checked = true);
          break;
        case 'none':
          checkboxes.forEach(cb => cb.checked = false);
          break;
      }
      
      this.lastSelection = value;
    }

    reset() {
      this.lastSelection = 'all';
      const select = document.getElementById(CONFIG.SELECT_DROPDOWN_ID);
      if (select) select.value = 'all';
    }

    reapplyIfNeeded() {
      const select = document.getElementById(CONFIG.SELECT_DROPDOWN_ID);
      if (select && this.lastSelection !== 'custom') {
        select.value = this.lastSelection;
        this.applySelection(this.lastSelection);
      }
    }
  }

  // ============================================================================
  // UI BUILDER
  // ============================================================================
  class UIBuilder {
    static getInputStyles(isDark) {
      return isDark 
        ? `background:${CONFIG.STYLES.DARK_BG};color:${CONFIG.STYLES.DARK_TEXT};border:1px solid ${CONFIG.STYLES.DARK_BORDER};`
        : `background:${CONFIG.STYLES.LIGHT_BG};color:${CONFIG.STYLES.LIGHT_TEXT};border:1px solid ${CONFIG.STYLES.LIGHT_BORDER};`;
    }

    static createDropdownHTML() {
      return '';
    }

    static createButton() {
      const btn = document.createElement('button');
      btn.id = CONFIG.BUTTON_ID;
      btn.textContent = 'Export Chat';
      btn.title = 'Click to export this chat. Select multiple chats from sidebar to export all.';
      
      Object.assign(btn.style, {
        position: 'fixed',
        top: '80px',
        right: '20px',
        zIndex: '9999',
        padding: '8px 16px',
        background: CONFIG.STYLES.BUTTON_PRIMARY,
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        fontSize: '1em',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        cursor: 'pointer',
        fontWeight: 'bold',
        transition: 'background 0.2s'
      });
      
      btn.addEventListener('mouseenter', () => btn.style.background = CONFIG.STYLES.BUTTON_HOVER);
      btn.addEventListener('mouseleave', () => btn.style.background = CONFIG.STYLES.BUTTON_PRIMARY);
      
      return btn;
    }

    static createDropdown() {
      return null;
    }

    static injectSidebarCheckboxes() {
      if (document.getElementById('gemini-sidebar-checkbox-injected')) return;
      
      const sidebar = document.querySelector('[data-test-id="all-conversations"]') || 
                      document.querySelector('.conversations-container') ||
                      document.querySelector('.chat-history');
      if (!sidebar) {
        console.log('[AI Chat Exporter] Sidebar not found');
        return;
      }
      
      const chatLinks = sidebar.querySelectorAll('a[data-test-id="conversation"]');
      console.log('[AI Chat Exporter] Found chat links:', chatLinks.length);
      
      if (chatLinks.length === 0) return;
      
      chatLinks.forEach((link, index) => {
        if (link.querySelector('input[type="checkbox"]')) return;
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = link.href;
        checkbox.title = 'Select to export this chat';
        checkbox.style.marginRight = '8px';
        checkbox.style.cursor = 'pointer';
        checkbox.style.zIndex = '9999';
        checkbox.style.position = 'relative';
        
        link.insertBefore(checkbox, link.firstChild);
      });
      
      const marker = document.createElement('div');
      marker.id = 'gemini-sidebar-checkbox-injected';
      marker.style.display = 'none';
      document.body.appendChild(marker);
    }
  }

  function tableToMarkdown(table, service) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return '';

    const toCells = row => Array.from(row.querySelectorAll('th,td'))
      .map(cell => service.turndown(cell.innerHTML).replace(/\n+/g, ' ').trim());

    const header = toCells(rows[0]);
    const separator = header.map(() => '---');
    const body = rows.slice(1).map(toCells);

    const lines = [
      `| ${header.join(' | ')} |`,
      `| ${separator.join(' | ')} |`,
      ...body.map(r => `| ${r.join(' | ')} |`)
    ];

    return `${lines.join('\n')}\n\n`;
  }

  function inlineText(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node;
    if (el.matches(CONFIG.MATH_INLINE_SELECTOR)) {
      const latex = el.getAttribute('data-math') || '';
      return `$${latex}$`;
    }

    const tag = el.tagName.toLowerCase();
    if (tag === 'br') return '\n';
    if (tag === 'b' || tag === 'strong') {
      return `**${Array.from(el.childNodes).map(inlineText).join('')}**`;
    }
    if (tag === 'i' || tag === 'em') {
      return `*${Array.from(el.childNodes).map(inlineText).join('')}*`;
    }
    if (tag === 'code') {
      return `\`${el.textContent || ''}\``;
    }

    return Array.from(el.childNodes).map(inlineText).join('');
  }

  function blockText(el) {
    if (!el) return '';

    if (el.nodeType === Node.TEXT_NODE) {
      return (el.textContent || '').trim();
    }

    if (el.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = el.tagName.toLowerCase();

    if (el.matches(CONFIG.MATH_BLOCK_SELECTOR)) {
      const latex = el.getAttribute('data-math') || '';
      return `$$${latex}$$\n\n`;
    }

    switch (tag) {
      case 'h1': return `# ${inlineText(el)}\n\n`;
      case 'h2': return `## ${inlineText(el)}\n\n`;
      case 'h3': return `### ${inlineText(el)}\n\n`;
      case 'h4': return `#### ${inlineText(el)}\n\n`;
      case 'h5': return `##### ${inlineText(el)}\n\n`;
      case 'h6': return `###### ${inlineText(el)}\n\n`;
      case 'p': return `${inlineText(el)}\n\n`;
      case 'hr': return `---\n\n`;
      case 'blockquote': {
        const lines = Array.from(el.childNodes).map(blockText).join('').trim().split('\n');
        return lines.map(line => line ? `> ${line}` : '>').join('\n') + '\n\n';
      }
      case 'pre': {
        const code = el.textContent || '';
        return `\
\
\
${code}\n\
\
\n`;
      }
      case 'ul': {
        const items = Array.from(el.querySelectorAll(':scope > li'))
          .map(li => `- ${inlineText(li).trim()}`)
          .join('\n');
        return `${items}\n\n`;
      }
      case 'ol': {
        const items = Array.from(el.querySelectorAll(':scope > li'))
          .map((li, i) => `${i + 1}. ${inlineText(li).trim()}`)
          .join('\n');
        return `${items}\n\n`;
      }
      case 'table': {
        const rows = Array.from(el.querySelectorAll('tr'));
        if (!rows.length) return '';
        const cells = row => Array.from(row.querySelectorAll('th,td'))
          .map(cell => inlineText(cell).replace(/\n/g, ' ').trim());
        const header = cells(rows[0]);
        const sep = header.map(() => '---');
        const body = rows.slice(1).map(r => cells(r));
        const lines = [
          `| ${header.join(' | ')} |`,
          `| ${sep.join(' | ')} |`,
          ...body.map(r => `| ${r.join(' | ')} |`)
        ];
        return `${lines.join('\n')}\n\n`;
      }
      case 'div':
      case 'section':
      case 'article':
      default: {
        return Array.from(el.childNodes).map(blockText).join('');
      }
    }
  }

  // ============================================================================
  // EXPORT SERVICE
  // ============================================================================
  class ExportService {
    constructor(checkboxManager) {
      this.checkboxManager = checkboxManager;
      this.markdownConverter = new MarkdownConverter();
      this.attachmentService = new AttachmentService();
    }

    _buildMarkdownHeader(conversationTitle) {
      const title = conversationTitle || CONFIG.MARKDOWN_HEADER;
      const timestamp = DateUtils.getLocaleString();
      return `# ${title}\n\n> ${CONFIG.EXPORT_TIMESTAMP_FORMAT} ${timestamp}\n\n---\n\n`;
    }

    async buildMarkdown(turns, conversationTitle, includeAttachments, exportFolder) {
      let markdown = this._buildMarkdownHeader(conversationTitle);

      for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        DOMUtils.createNotification(`Processing message ${i + 1} of ${turns.length}...`);

        const userQueryElem = turn.querySelector(CONFIG.SELECTORS.USER_QUERY);
        if (userQueryElem) {
          const cb = userQueryElem.querySelector(`.${CONFIG.CHECKBOX_CLASS}`);
          if (cb?.checked) {
            const userQuery = this.markdownConverter.extractUserQuery(userQueryElem);
            
            let attachmentMarkdown = '';
            if (includeAttachments) {
              const attachments = this.attachmentService.findUserAttachments(userQueryElem);
              
              for (const attachment of attachments) {
                if (attachment.type === 'image') {
                  const base64 = await this.attachmentService.imageToBase64(attachment.src);
                  if (base64) {
                    attachmentMarkdown += `\n![${attachment.name || 'image'}](${base64})\n`;
                  }
                } else if (attachment.type === 'file') {
                  const safeName = this.attachmentService.sanitizeFilename(attachment.name || 'file');
                  const savedPath = await this.attachmentService.downloadFile(
                    attachment.src || '', 
                    safeName, 
                    exportFolder
                  );
                  if (savedPath) {
                    attachmentMarkdown += `\n[Attachment: ${safeName}](${savedPath})\n`;
                  }
                }
              }
            }
            
            if (userQuery || attachmentMarkdown) {
              markdown += `## 👤 You\n\n${userQuery}${attachmentMarkdown}\n\n`;
            }
          }
        }

        const modelRespElem = turn.querySelector(CONFIG.SELECTORS.MODEL_RESPONSE);
        if (modelRespElem) {
          const cb = modelRespElem.querySelector(`.${CONFIG.CHECKBOX_CLASS}`);
          if (cb?.checked) {
            const modelResponse = this.markdownConverter.extractModelResponse(modelRespElem);
            if (modelResponse) {
              markdown += `## 🤖 Gemini\n\n${modelResponse}\n\n`;
            } else {
              markdown += `## 🤖 Gemini\n\n[Note: Could not extract model response from message ${i + 1}.]\n\n`;
            }
          }
        }

        markdown += '---\n\n';
      }

      return markdown;
    }

    async execute(exportMode, customFilename, includeAttachments = true) {
      try {
        await ScrollService.loadAllMessages();

        const turns = Array.from(document.querySelectorAll(CONFIG.SELECTORS.CONVERSATION_TURN));
        this.checkboxManager.injectCheckboxes();

        if (!this.checkboxManager.hasAnyChecked()) {
          alert('Please select at least one message to export using the checkboxes or the dropdown.');
          return;
        }

        const conversationTitle = FilenameService.getConversationTitle();
        const exportFolder = FilenameService.generate(customFilename, conversationTitle);
        const markdown = await this.buildMarkdown(turns, conversationTitle, includeAttachments, exportFolder);

        if (exportMode === 'clipboard') {
          await FileExportService.exportToClipboard(markdown);
        } else {
          FileExportService.downloadMarkdown(markdown, exportFolder);
        }

      } catch (error) {
        console.error('Export error:', error);
        alert(`Export failed: ${error.message}`);
      }
    }

    async executeForChat(chatUrl, exportMode, includeAttachments = true) {
      const currentUrl = window.location.href;
      
      if (chatUrl !== currentUrl) {
        window.location.href = chatUrl;
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      await this.execute(exportMode, '', includeAttachments);
    }
  }

  // ============================================================================
  // EXPORT CONTROLLER
  // ============================================================================
  class ExportController {
    constructor() {
      this.checkboxManager = new CheckboxManager();
      this.selectionManager = new SelectionManager(this.checkboxManager);
      this.exportService = new ExportService(this.checkboxManager);
      this.button = null;
    }

    init() {
      this.createUI();
      this.attachEventListeners();
      this.observeStorageChanges();
    }

    createUI() {
      this.button = UIBuilder.createButton();
      document.body.appendChild(this.button);
    }

    attachEventListeners() {
      this.button.addEventListener('click', () => this.handleButtonClick());
    }

    async handleButtonClick() {
      console.log('[AI Chat Exporter] Export button clicked');
      
      UIBuilder.injectSidebarCheckboxes();
      
      const selectedChats = this.getSelectedChatsFromSidebar();
      console.log('[AI Chat Exporter] Selected chats:', selectedChats.length);
      
      this.button.disabled = true;
      this.button.textContent = 'Exporting...';
      
      try {
        if (selectedChats.length > 0) {
          let exported = 0;
          for (const chatUrl of selectedChats) {
            this.button.textContent = `Exporting ${exported + 1}/${selectedChats.length}...`;
            await this.exportService.executeForChat(chatUrl, 'file', true);
            exported++;
          }
          this.button.textContent = `Exported ${exported} chats!`;
        } else {
          await this.exportService.execute('file', '', true);
          this.button.textContent = 'Exported!';
        }
      } catch (error) {
        console.error('[AI Chat Exporter] Export error:', error);
        alert('Export failed: ' + error.message);
      } finally {
        setTimeout(() => {
          this.button.disabled = false;
          this.button.textContent = 'Export Chat';
        }, 2000);
      }
    }

    getSelectedChatsFromSidebar() {
      const checkboxes = document.querySelectorAll('input[type="checkbox"][value*="/app/"]:checked');
      return Array.from(checkboxes).map(cb => cb.value);
    }

    observeStorageChanges() {
      const updateVisibility = () => {
        try {
          if (chrome?.storage?.sync) {
            chrome.storage.sync.get(['hideExportBtn'], (result) => {
              this.button.style.display = result.hideExportBtn ? 'none' : '';
            });
          }
        } catch (e) {
          console.error('Storage access error:', e);
        }
      };

      updateVisibility();

      const observer = new MutationObserver(updateVisibility);
      observer.observe(document.body, { childList: true, subtree: true });

      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'sync' && 'hideExportBtn' in changes) {
            updateVisibility();
          }
        });
      }
    }
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  const controller = new ExportController();
  controller.init();

})();
