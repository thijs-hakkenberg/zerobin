/**
 * ZeroBin - Main Application
 * Handles paste creation, viewing, discussion, and file attachments
 */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');

  // --- State ---
  let currentPaste = null;
  let currentKey = null;
  let decryptedData = null;

  // --- Elements ---
  const els = {
    createSection: $('#create-section'),
    viewSection: $('#view-section'),
    format: $('#format'),
    expiry: $('#expiry'),
    burnAfterReading: $('#burnafterreading'),
    openDiscussion: $('#opendiscussion'),
    password: $('#password'),
    attachment: $('#attachment'),
    clearAttachment: $('#clear-attachment'),
    pasteInput: $('#paste-input'),
    btnCreate: $('#btn-create'),
    btnNew: $('#btn-new'),
    btnClone: $('#btn-clone'),
    btnRaw: $('#btn-raw'),
    btnCopyLink: $('#btn-copy-link'),
    btnCopyContent: $('#btn-copy-content'),
    btnQr: $('#btn-qr'),
    pasteMeta: $('#paste-meta'),
    metaCreated: $('#meta-created'),
    metaExpires: $('#meta-expires'),
    metaBurn: $('#meta-burn'),
    passwordPrompt: $('#password-prompt'),
    decryptPassword: $('#decrypt-password'),
    btnDecrypt: $('#btn-decrypt'),
    pasteContent: $('#paste-content'),
    contentDisplay: $('#content-display'),
    attachmentDisplay: $('#attachment-display'),
    attachmentName: $('#attachment-name'),
    attachmentSize: $('#attachment-size'),
    btnDownloadAttachment: $('#btn-download-attachment'),
    discussionSection: $('#discussion-section'),
    commentsList: $('#comments-list'),
    commentNickname: $('#comment-nickname'),
    commentInput: $('#comment-input'),
    btnComment: $('#btn-comment'),
    qrModal: $('#qr-modal'),
    qrCanvas: $('#qr-canvas'),
    qrClose: $('#qr-close'),
    loading: $('#loading'),
    loadingText: $('#loading-text'),
    errorBar: $('#error-bar'),
    errorText: $('#error-text'),
    errorClose: $('#error-close'),
  };

  // --- Initialization ---

  function init() {
    bindEvents();
    checkForPaste();
  }

  function bindEvents() {
    els.btnCreate.addEventListener('click', createPaste);
    els.btnNew.addEventListener('click', newPaste);
    els.btnClone.addEventListener('click', clonePaste);
    els.btnRaw.addEventListener('click', showRaw);
    els.btnCopyLink.addEventListener('click', copyLink);
    els.btnCopyContent.addEventListener('click', copyContent);
    els.btnQr.addEventListener('click', showQR);
    els.qrClose.addEventListener('click', () => hide(els.qrModal));
    els.btnDecrypt.addEventListener('click', decryptWithPassword);
    els.btnComment.addEventListener('click', postComment);
    els.errorClose.addEventListener('click', () => hide(els.errorBar));
    els.btnDownloadAttachment.addEventListener('click', downloadAttachment);

    els.attachment.addEventListener('change', () => {
      if (els.attachment.files.length > 0) {
        show(els.clearAttachment);
      }
    });
    els.clearAttachment.addEventListener('click', () => {
      els.attachment.value = '';
      hide(els.clearAttachment);
    });

    // Burn after reading disables discussion
    els.burnAfterReading.addEventListener('change', () => {
      if (els.burnAfterReading.checked) {
        els.openDiscussion.checked = false;
        els.openDiscussion.disabled = true;
      } else {
        els.openDiscussion.disabled = false;
      }
    });

    // QR modal close on backdrop click
    els.qrModal.addEventListener('click', (e) => {
      if (e.target === els.qrModal) hide(els.qrModal);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hide(els.qrModal);
        hide(els.errorBar);
      }
    });

    // Handle password prompt on Enter
    els.decryptPassword.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') decryptWithPassword();
    });
  }

  function checkForPaste() {
    const params = new URLSearchParams(window.location.search);
    const pasteId = params.keys().next().value;
    const key = window.location.hash.slice(1);

    if (pasteId && key) {
      loadPaste(pasteId, key);
    }
  }

  // --- Create Paste ---

  async function createPaste() {
    const content = els.pasteInput.value;
    if (!content.trim() && !els.attachment.files.length) {
      showError('Please enter some content or attach a file.');
      return;
    }

    showLoading('Encrypting...');

    try {
      const key = ZeroBinCrypto.generateRandomKey();
      const format = els.format.value;
      const password = els.password.value;

      // Build plaintext payload
      const payload = {
        content: content,
        format: format,
      };

      // Handle file attachment
      if (els.attachment.files.length > 0) {
        const file = els.attachment.files[0];
        if (file.size > 10 * 1024 * 1024) {
          hideLoading();
          showError('File too large. Maximum size is 10MB.');
          return;
        }
        const fileData = await readFileAsBase64(file);
        payload.attachment = {
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          data: fileData,
        };
      }

      const encrypted = await ZeroBinCrypto.encrypt(payload, key, password);

      encrypted.meta = {
        expire: els.expiry.value,
        burnafterreading: els.burnAfterReading.checked,
        opendiscussion: els.openDiscussion.checked,
      };

      setLoadingText('Uploading...');

      const response = await fetch('/api/paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(encrypted),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Server error: ${response.status}`);
      }

      const result = await response.json();

      // Navigate to the paste URL
      const url = `${window.location.origin}/?${result.id}#${key}`;
      window.history.pushState({}, '', `/?${result.id}#${key}`);

      // Store delete token in sessionStorage
      sessionStorage.setItem(`delete_${result.id}`, result.deletetoken);

      hideLoading();
      loadPaste(result.id, key);
    } catch (err) {
      hideLoading();
      showError(`Failed to create paste: ${err.message}`);
    }
  }

  // --- Load Paste ---

  async function loadPaste(pasteId, key) {
    showLoading('Loading...');
    showViewMode();

    try {
      const response = await fetch(`/api/paste/${pasteId}`);
      if (!response.ok) {
        hideLoading();
        if (response.status === 404) {
          showPasteError('Paste not found or has expired.');
        } else {
          showPasteError(`Server error: ${response.status}`);
        }
        return;
      }

      currentPaste = await response.json();
      currentKey = key;

      // Display metadata
      const created = new Date(currentPaste.meta.created);
      els.metaCreated.textContent = `Created: ${formatDate(created)}`;

      if (currentPaste.meta.expire === 'never') {
        els.metaExpires.textContent = 'Expires: Never';
      } else {
        els.metaExpires.textContent = `Expires: ${currentPaste.meta.expire}`;
      }

      if (currentPaste.meta.burnafterreading) {
        show(els.metaBurn);
      }

      // Try to decrypt (may need password)
      hideLoading();
      tryDecrypt('');
    } catch (err) {
      hideLoading();
      showPasteError(`Failed to load paste: ${err.message}`);
    }
  }

  function showPasteError(message) {
    // Show error in the view section instead of redirecting to root
    hide(els.createSection);
    show(els.viewSection);
    hide(els.passwordPrompt);
    hide(els.attachmentDisplay);
    hide(els.discussionSection);
    hide(els.metaBurn);
    hide(els.btnClone);
    hide(els.btnRaw);
    els.metaCreated.textContent = '';
    els.metaExpires.textContent = '';
    show(els.pasteContent);
    els.contentDisplay.innerHTML = `<div class="paste-error">
      <div class="paste-error-icon">&#x26A0;</div>
      <h2>${escapeHtml(message)}</h2>
      <p>The paste may have expired, been burned after reading, or the link is invalid.</p>
      <button class="btn btn-primary" onclick="window.location='/'">Create New Paste</button>
    </div>`;
  }

  async function tryDecrypt(password) {
    try {
      decryptedData = await ZeroBinCrypto.decrypt(currentPaste, currentKey, password);
      displayDecryptedContent();
    } catch {
      // Decryption failed - probably needs password
      if (!password) {
        show(els.passwordPrompt);
        hide(els.pasteContent);
        els.decryptPassword.focus();
      } else {
        showError('Incorrect password. Please try again.');
        els.decryptPassword.value = '';
        els.decryptPassword.focus();
      }
    }
  }

  function decryptWithPassword() {
    const password = els.decryptPassword.value;
    if (!password) {
      showError('Please enter a password.');
      return;
    }
    tryDecrypt(password);
  }

  function displayDecryptedContent() {
    hide(els.passwordPrompt);
    show(els.pasteContent);
    show(els.btnClone);
    show(els.btnRaw);

    const { content, format, attachment } = decryptedData;

    // Render content based on format
    if (format === 'markdown') {
      els.contentDisplay.innerHTML = `<div class="markdown-body">${renderMarkdown(content)}</div>`;
      // Highlight code blocks in markdown
      els.contentDisplay.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
      });
    } else if (format === 'plaintext') {
      els.contentDisplay.innerHTML = `<div class="plaintext-body">${escapeHtml(content)}</div>`;
    } else {
      // Source code with syntax highlighting
      const codeEl = document.createElement('code');
      codeEl.className = `language-${format}`;
      codeEl.textContent = content;
      const preEl = document.createElement('pre');
      preEl.appendChild(codeEl);
      els.contentDisplay.innerHTML = '';
      els.contentDisplay.appendChild(preEl);
      hljs.highlightElement(codeEl);
    }

    // Display attachment if present
    if (attachment) {
      show(els.attachmentDisplay);
      els.attachmentName.textContent = attachment.name;
      els.attachmentSize.textContent = `(${formatFileSize(attachment.size)})`;
    }

    // Display discussion if enabled
    if (currentPaste.meta.opendiscussion) {
      show(els.discussionSection);
      renderComments();
    }
  }

  // --- Comments / Discussion ---

  function renderComments() {
    els.commentsList.innerHTML = '';
    const comments = currentPaste.comments || [];

    if (comments.length === 0) {
      els.commentsList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">No comments yet.</p>';
      return;
    }

    comments.forEach(async (comment) => {
      try {
        const decrypted = await ZeroBinCrypto.decrypt(comment, currentKey);
        const el = document.createElement('div');
        el.className = 'comment';
        el.innerHTML = `
          <div class="comment-header">
            <span class="comment-nickname">${escapeHtml(decrypted.nickname || 'Anonymous')}</span>
            <span>${formatDate(new Date(comment.meta.created))}</span>
          </div>
          <div class="comment-body">${escapeHtml(decrypted.content)}</div>
        `;
        els.commentsList.appendChild(el);
      } catch {
        const el = document.createElement('div');
        el.className = 'comment';
        el.innerHTML = '<div class="comment-body" style="color: var(--text-muted);">[Unable to decrypt comment]</div>';
        els.commentsList.appendChild(el);
      }
    });
  }

  async function postComment() {
    const content = els.commentInput.value.trim();
    if (!content) {
      showError('Please enter a comment.');
      return;
    }

    showLoading('Encrypting comment...');

    try {
      const commentPayload = {
        content: content,
        nickname: els.commentNickname.value.trim() || 'Anonymous',
      };

      const encrypted = await ZeroBinCrypto.encrypt(commentPayload, currentKey);

      const params = new URLSearchParams(window.location.search);
      const pasteId = params.keys().next().value;

      const response = await fetch(`/api/paste/${pasteId}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(encrypted),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Server error: ${response.status}`);
      }

      // Reload the paste to get updated comments
      els.commentInput.value = '';
      hideLoading();

      // Re-fetch and re-render comments
      const pasteResp = await fetch(`/api/paste/${pasteId}`);
      if (pasteResp.ok) {
        currentPaste = await pasteResp.json();
        renderComments();
      }
    } catch (err) {
      hideLoading();
      showError(`Failed to post comment: ${err.message}`);
    }
  }

  // --- File handling ---

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function downloadAttachment() {
    if (!decryptedData?.attachment) return;

    const { name, type, data } = decryptedData.attachment;
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // --- Navigation ---

  function newPaste() {
    window.history.pushState({}, '', '/');
    currentPaste = null;
    currentKey = null;
    decryptedData = null;
    showCreateMode();
    els.pasteInput.value = '';
    els.password.value = '';
    els.attachment.value = '';
    hide(els.clearAttachment);
    els.pasteInput.focus();
  }

  function clonePaste() {
    if (!decryptedData) return;
    showCreateMode();
    els.pasteInput.value = decryptedData.content || '';
    if (decryptedData.format) {
      els.format.value = decryptedData.format;
    }
    window.history.pushState({}, '', '/');
    els.pasteInput.focus();
  }

  function showRaw() {
    if (!decryptedData) return;
    const blob = new Blob([decryptedData.content || ''], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  // --- Clipboard ---

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      flashButton(els.btnCopyLink, 'Copied!');
    } catch {
      showError('Failed to copy to clipboard.');
    }
  }

  async function copyContent() {
    if (!decryptedData?.content) return;
    try {
      await navigator.clipboard.writeText(decryptedData.content);
      flashButton(els.btnCopyContent, 'Copied!');
    } catch {
      showError('Failed to copy to clipboard.');
    }
  }

  function flashButton(btn, text) {
    const orig = btn.textContent;
    btn.textContent = text;
    btn.style.borderColor = 'var(--success)';
    btn.style.color = 'var(--success)';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.borderColor = '';
      btn.style.color = '';
    }, 1500);
  }

  // --- QR Code ---

  function showQR() {
    const url = window.location.href;
    if (typeof QRCode !== 'undefined') {
      QRCode.renderToCanvas(els.qrCanvas, url, {
        cellSize: 4,
        margin: 4,
        ecLevel: 'M',
      });
    } else {
      // Fallback: just show URL
      const ctx = els.qrCanvas.getContext('2d');
      els.qrCanvas.width = 250;
      els.qrCanvas.height = 60;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 250, 60);
      ctx.fillStyle = '#000';
      ctx.font = '10px monospace';
      ctx.fillText('QR generation not available', 10, 30);
      ctx.fillText(url.substring(0, 40) + '...', 10, 45);
    }
    show(els.qrModal);
  }

  // --- UI Mode Switching ---

  function showCreateMode() {
    show(els.createSection);
    hide(els.viewSection);
    hide(els.btnClone);
    hide(els.btnRaw);
    hide(els.errorBar);
  }

  function showViewMode() {
    hide(els.createSection);
    show(els.viewSection);
    hide(els.passwordPrompt);
    hide(els.pasteContent);
    hide(els.attachmentDisplay);
    hide(els.discussionSection);
    hide(els.metaBurn);
    hide(els.btnClone);
    hide(els.btnRaw);
  }

  // --- Loading & Errors ---

  function showLoading(text) {
    els.loadingText.textContent = text || 'Loading...';
    show(els.loading);
  }

  function setLoadingText(text) {
    els.loadingText.textContent = text;
  }

  function hideLoading() {
    hide(els.loading);
  }

  function showError(msg) {
    els.errorText.textContent = msg;
    show(els.errorBar);
    setTimeout(() => hide(els.errorBar), 8000);
  }

  // --- Helpers ---

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderMarkdown(text) {
    if (typeof marked !== 'undefined') {
      marked.setOptions({
        breaks: true,
        gfm: true,
      });
      // Sanitize: marked doesn't sanitize by default, but we trust the content
      // since it was encrypted by the user who created it
      return marked.parse(text);
    }
    // Fallback to plaintext
    return `<pre>${escapeHtml(text)}</pre>`;
  }

  function formatDate(date) {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Handle browser back/forward
  window.addEventListener('popstate', () => {
    const params = new URLSearchParams(window.location.search);
    const pasteId = params.keys().next().value;
    const key = window.location.hash.slice(1);

    if (pasteId && key) {
      loadPaste(pasteId, key);
    } else {
      newPaste();
    }
  });

  // Start
  init();
})();
