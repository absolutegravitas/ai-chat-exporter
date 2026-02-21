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
      
      // Attachment selectors
      ATTACHMENT_IMAGE: 'img[src*="upload"], img[src*="file"], img.uploaded-image',
      ATTACHMENT_FILE_CHIP: '[data-file-name], .file-chip, .uploaded-file',
      ATTACHMENT_CONTAINER: '.attachment, .uploaded-media, [data-test-id="attachment"]'
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
      
      const images = userQueryElement.querySelectorAll(CONFIG.SELECTORS.ATTACHMENT_IMAGE);
      images.forEach((img, index) => {
        const src = img.src.startsWith('data:') ? img.src : 
          (img.src.startsWith('http') ? img.src : this.baseUrl + img.src);
        attachments.push({
          type: 'image',
          src: src,
          index: index,
          element: img
        });
      });

      const fileChips = userQueryElement.querySelectorAll(CONFIG.SELECTORS.ATTACHMENT_FILE_CHIP);
      fileChips.forEach((chip, index) => {
        const fileName = chip.getAttribute('data-file-name') || 
                         chip.textContent?.trim() || 
                         chip.getAttribute('aria-label') ||
                         `uploaded_file_${index + 1}`;
        attachments.push({
          type: 'file',
          name: fileName,
          index: index,
          element: chip
        });
      });

      const attachmentContainers = userQueryElement.querySelectorAll(CONFIG.SELECTORS.ATTACHMENT_CONTAINER);
      attachmentContainers.forEach((container, index) => {
        const img = container.querySelector('img');
        const fileName = container.getAttribute('data-filename') || 
                         container.getAttribute('data-file-name') ||
                         `attachment_${index + 1}`;
        
        if (img) {
          attachments.push({
            type: 'image',
            src: img.src,
            index: index,
            element: container
          });
        } else {
          attachments.push({
            type: 'file',
            name: fileName,
            index: index,
            element: container
          });
        }
      });

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
      const isDark = DOMUtils.isDarkMode();
      const inputStyles = this.getInputStyles(isDark);
      
      return `
        <div id="gemini-progress-container" style="display:none;margin-bottom:12px;">
          <div style="font-size:12px;margin-bottom:4px;" id="gemini-progress-text">Exporting...</div>
          <div style="width:100%;height:8px;background:#eee;border-radius:4px;overflow:hidden;">
            <div id="gemini-progress-bar" style="width:0%;height:100%;background:#1a73e8;transition:width 0.3s;"></div>
          </div>
        </div>
        <div style="margin-top:10px;">
          <label style="margin-right:10px;">
            <input type="radio" name="${CONFIG.EXPORT_MODE_NAME}" value="file" checked>
            Export as file
          </label>
          <label>
            <input type="radio" name="${CONFIG.EXPORT_MODE_NAME}" value="clipboard">
            Export to clipboard
          </label>
        </div>
        <div id="gemini-filename-row" style="margin-top:10px;display:block;">
          <label for="${CONFIG.FILENAME_INPUT_ID}" style="font-weight:bold;">
            Filename <span style='color:#888;font-weight:normal;'>(optional)</span>:
          </label>
          <input id="${CONFIG.FILENAME_INPUT_ID}" type="text" 
                 style="margin-left:8px;padding:2px 8px;width:260px;${inputStyles}" 
                 value="">
          <span style="display:block;font-size:0.95em;color:#888;margin-top:2px;">
            Optional. Leave blank to use chat title or timestamp. 
            Only <b>.md</b> (Markdown) files are supported. Do not include an extension.
          </span>
        </div>
        <div style="margin-top:14px;">
          <label style="font-weight:bold;">Select messages:</label>
          <select id="${CONFIG.SELECT_DROPDOWN_ID}" 
                  style="margin-left:8px;padding:2px 8px;${inputStyles}">
            <option value="all">All</option>
            <option value="ai">Only answers</option>
            <option value="none">None</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div style="margin-top:14px;border-top:1px solid #ccc;padding-top:10px;">
          <label style="font-weight:bold;">
            <input type="checkbox" id="gemini-include-attachments" checked>
            Include attachments
          </label>
          <div style="margin-left:24px;margin-top:6px;font-size:0.9em;color:#666;">
            <span style="display:block;">Images: Embedded as Base64 in Markdown</span>
            <span style="display:block;">Other files: Downloaded to attachments/ subfolder</span>
          </div>
        </div>
        <div style="margin-top:14px;border-top:1px solid #ccc;padding-top:10px;">
          <label style="font-weight:bold;">
            <input type="checkbox" id="gemini-multi-chat">
            Export multiple chats
          </label>
          <div id="gemini-chat-list" style="display:none;max-height:150px;overflow-y:auto;margin-top:8px;border:1px solid #ddd;border-radius:4px;padding:4px;">
            <div style="font-size:11px;color:#888;padding:4px;">
              <a href="#" id="gemini-load-chats" style="color:#1a73e8;">Click to load your chat list</a>
            </div>
          </div>
        </div>
        <div style="margin-top:10px;font-size:11px;color:#888;text-align:center;">
          Settings are saved automatically for next time
        </div>
      `;
    }

    static createButton() {
      const btn = document.createElement('button');
      btn.id = CONFIG.BUTTON_ID;
      btn.textContent = 'Export Chat';
      
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
      const dropdown = document.createElement('div');
      dropdown.id = CONFIG.DROPDOWN_ID;
      
      const isDark = DOMUtils.isDarkMode();
      Object.assign(dropdown.style, {
        position: 'fixed',
        top: '124px',
        right: '20px',
        zIndex: '9999',
        border: '1px solid #ccc',
        borderRadius: '6px',
        padding: '10px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        display: 'none',
        background: isDark ? '#222' : '#fff',
        color: isDark ? '#fff' : '#222'
      });
      
      dropdown.innerHTML = this.createDropdownHTML();
      return dropdown;
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
      this.dropdown = null;
    }

    init() {
      this.createUI();
      this.attachEventListeners();
      this.observeStorageChanges();
    }

    createUI() {
      this.button = UIBuilder.createButton();
      this.dropdown = UIBuilder.createDropdown();
      
      document.body.appendChild(this.dropdown);
      document.body.appendChild(this.button);
      
      this.setupFilenameRowToggle();
    }

    setupFilenameRowToggle() {
      const updateFilenameRow = () => {
        const fileRow = this.dropdown.querySelector('#gemini-filename-row');
        const fileRadio = this.dropdown.querySelector(`input[name="${CONFIG.EXPORT_MODE_NAME}"][value="file"]`);
        if (fileRow && fileRadio) {
          fileRow.style.display = fileRadio.checked ? 'block' : 'none';
        }
      };

      this.dropdown.querySelectorAll(`input[name="${CONFIG.EXPORT_MODE_NAME}"]`)
        .forEach(radio => radio.addEventListener('change', updateFilenameRow));
      
      updateFilenameRow();
    }

    attachEventListeners() {
      this.button.addEventListener('click', () => this.handleButtonClick());

      const selectDropdown = this.dropdown.querySelector(`#${CONFIG.SELECT_DROPDOWN_ID}`);
      selectDropdown.addEventListener('change', (e) => this.handleSelectionChange(e.target.value));

      const modeRadios = this.dropdown.querySelectorAll(`input[name="${CONFIG.EXPORT_MODE_NAME}"]`);
      modeRadios.forEach(radio => {
        radio.addEventListener('change', () => this.updateFilenameRowVisibility());
      });

      const multiChatCheckbox = this.dropdown.querySelector('#gemini-multi-chat');
      if (multiChatCheckbox) {
        multiChatCheckbox.addEventListener('change', (e) => {
          const chatList = this.dropdown.querySelector('#gemini-chat-list');
          if (chatList) {
            chatList.style.display = e.target.checked ? 'block' : 'none';
          }
        });
      }

      const loadChatsLink = this.dropdown.querySelector('#gemini-load-chats');
      if (loadChatsLink) {
        loadChatsLink.addEventListener('click', (e) => {
          e.preventDefault();
          this.loadChatList();
        });
      }

      document.addEventListener('change', (e) => {
        if (e.target?.classList?.contains(CONFIG.CHECKBOX_CLASS)) {
          const select = document.getElementById(CONFIG.SELECT_DROPDOWN_ID);
          if (select && select.value !== 'custom') {
            select.value = 'custom';
            this.selectionManager.lastSelection = 'custom';
          }
        }
      });

      document.addEventListener('mousedown', (e) => {
        if (this.dropdown.style.display !== 'none' && 
            !this.dropdown.contains(e.target) && 
            e.target !== this.button) {
          this.dropdown.style.display = 'none';
        }
      });
    }

    async loadChatList() {
      const chatList = this.dropdown.querySelector('#gemini-chat-list');
      if (!chatList) return;
      
      chatList.innerHTML = '<div style="padding:8px;font-size:12px;">Loading chats...</div>';
      
      const chatItems = document.querySelectorAll('a[href*="/chat/"]');
      const chats = [];
      const seen = new Set();
      
      chatItems.forEach(item => {
        const href = item.href;
        const title = item.textContent?.trim() || 'Untitled Chat';
        if (href && !seen.has(href)) {
          seen.add(href);
          chats.push({ href, title });
        }
      });
      
      if (chats.length === 0) {
        chatList.innerHTML = '<div style="padding:8px;font-size:12px;color:#888;">No chats found. Try opening the chat sidebar first.</div>';
        return;
      }
      
      chatList.innerHTML = chats.map(chat => `
        <label style="display:block;padding:4px 8px;cursor:pointer;font-size:12px;">
          <input type="checkbox" value="${chat.href}" style="margin-right:6px;">
          ${chat.title.substring(0, 40)}${chat.title.length > 40 ? '...' : ''}
        </label>
      `).join('');
    }

    handleSelectionChange(value) {
      this.checkboxManager.injectCheckboxes();
      this.selectionManager.applySelection(value);
    }

    async loadSettings() {
      const settings = await SettingsService.load();
      const defaults = SettingsService.getDefaults();
      
      const exportMode = settings[CONFIG.STORAGE_KEYS.EXPORT_MODE] || defaults[CONFIG.STORAGE_KEYS.EXPORT_MODE];
      const includeAttachments = settings[CONFIG.STORAGE_KEYS.INCLUDE_ATTACHMENTS] ?? defaults[CONFIG.STORAGE_KEYS.INCLUDE_ATTACHMENTS];
      const messageSelection = settings[CONFIG.STORAGE_KEYS.MESSAGE_SELECTION] || defaults[CONFIG.STORAGE_KEYS.MESSAGE_SELECTION];
      
      const modeRadios = this.dropdown.querySelectorAll(`input[name="${CONFIG.EXPORT_MODE_NAME}"]`);
      modeRadios.forEach(radio => {
        radio.checked = radio.value === exportMode;
      });
      
      const attachmentsCheckbox = this.dropdown.querySelector('#gemini-include-attachments');
      if (attachmentsCheckbox) attachmentsCheckbox.checked = includeAttachments;
      
      const selectionSelect = this.dropdown.querySelector(`#${CONFIG.SELECT_DROPDOWN_ID}`);
      if (selectionSelect) selectionSelect.value = messageSelection;
      
      this.updateFilenameRowVisibility();
    }

    updateFilenameRowVisibility() {
      const fileRow = this.dropdown.querySelector('#gemini-filename-row');
      const fileRadio = this.dropdown.querySelector(`input[name="${CONFIG.EXPORT_MODE_NAME}"][value="file"]`);
      if (fileRow && fileRadio) {
        fileRow.style.display = fileRadio.checked ? 'block' : 'none';
      }
    }

    showProgress(percent, text) {
      const container = this.dropdown.querySelector('#gemini-progress-container');
      const bar = this.dropdown.querySelector('#gemini-progress-bar');
      const progressText = this.dropdown.querySelector('#gemini-progress-text');
      if (container && bar && progressText) {
        container.style.display = 'block';
        bar.style.width = percent + '%';
        progressText.textContent = text;
      }
    }

    hideProgress() {
      const container = this.dropdown.querySelector('#gemini-progress-container');
      if (container) {
        container.style.display = 'none';
      }
    }

    async saveSettings() {
      const exportMode = this.dropdown.querySelector(`input[name="${CONFIG.EXPORT_MODE_NAME}"]:checked`)?.value || 'file';
      const includeAttachments = this.dropdown.querySelector('#gemini-include-attachments')?.checked ?? true;
      const messageSelection = this.dropdown.querySelector(`#${CONFIG.SELECT_DROPDOWN_ID}`)?.value || 'all';
      
      await SettingsService.save({
        [CONFIG.STORAGE_KEYS.EXPORT_MODE]: exportMode,
        [CONFIG.STORAGE_KEYS.INCLUDE_ATTACHMENTS]: includeAttachments,
        [CONFIG.STORAGE_KEYS.MESSAGE_SELECTION]: messageSelection
      });
    }

    async handleButtonClick() {
      this.checkboxManager.injectCheckboxes();
      
      if (this.dropdown.style.display === 'none') {
        await this.loadSettings();
        this.dropdown.style.display = '';
        this.updateFilenameRowVisibility();
        return;
      }

      const exportMode = this.dropdown.querySelector(`input[name="${CONFIG.EXPORT_MODE_NAME}"]:checked`)?.value || 'file';
      const customFilename = exportMode === 'file' 
        ? this.dropdown.querySelector(`#${CONFIG.FILENAME_INPUT_ID}`)?.value.trim() || ''
        : '';
      const includeAttachments = this.dropdown.querySelector('#gemini-include-attachments')?.checked ?? true;
      const multiChat = this.dropdown.querySelector('#gemini-multi-chat')?.checked ?? false;

      await this.saveSettings();
      
      this.dropdown.style.display = 'none';
      this.button.disabled = true;
      
      try {
        if (multiChat) {
          this.showProgress(0, 'Loading chats...');
          await this.exportMultiChat(exportMode, includeAttachments);
        } else {
          this.showProgress(30, 'Exporting chat...');
          await this.exportService.execute(exportMode, customFilename, includeAttachments);
          this.showProgress(100, 'Done!');
        }
      } catch (error) {
        console.error('Export error:', error);
      } finally {
        setTimeout(() => this.hideProgress(), 1500);
        this.button.disabled = false;
        this.button.textContent = 'Export Chat';
        this.checkboxManager.removeAll();
        this.selectionManager.reset();
      }
    }

    async exportMultiChat(exportMode, includeAttachments) {
      const chatList = this.dropdown.querySelector('#gemini-chat-list');
      const checkboxes = chatList?.querySelectorAll('input[type="checkbox"]:checked') || [];
      const chatLinks = Array.from(checkboxes).map(cb => cb.value);
      
      if (chatLinks.length === 0) {
        alert('Please select at least one chat to export');
        this.hideProgress();
        this.button.disabled = false;
        return;
      }

      let exported = 0;
      for (const chatUrl of chatLinks) {
        this.showProgress(Math.round((exported / chatLinks.length) * 100), `Exporting ${exported + 1}/${chatLinks.length}...`);
        
        try {
          await this.exportService.executeForChat(chatUrl, exportMode, includeAttachments);
        } catch (e) {
          console.warn('Failed to export chat:', chatUrl, e);
        }
        exported++;
      }
      
      this.showProgress(100, `Exported ${exported} chats!`);
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
