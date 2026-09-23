(function () {
  'use strict';

  // Requires js/vendor/simplewebauthn-browser.js to have loaded first and
  // exposed the global below; bail out quietly if it hasn't (e.g. blocked).
  var swa = window.SimpleWebAuthnBrowser;
  if (!swa) return;

  var openBtn = document.getElementById('t08-open-btn');
  var archiveModal = document.getElementById('t08-archive-modal');
  var archiveCloseBtn = archiveModal ? archiveModal.querySelector('[data-close]') : null;
  var lockedEl = document.getElementById('t08-locked');
  var unlockedEl = document.getElementById('t08-unlocked');
  var loginBtn = document.getElementById('t08-login-btn');
  var statusEl = document.getElementById('t08-login-status');
  var welcomeEl = document.getElementById('t08-welcome');
  var itemsEl = document.getElementById('t08-items');
  var itemsStatusEl = document.getElementById('t08-items-status');
  var addItemBtn = document.getElementById('t08-add-item-btn');
  var logoutBtn = document.getElementById('t08-logout-btn');
  var manageBtn = document.getElementById('t08-manage-btn');
  var manageModal = document.getElementById('t08-manage-modal');
  var passkeyListEl = document.getElementById('t08-passkey-list');
  var addPasskeyBtn = document.getElementById('t08-add-passkey-btn');
  var newDeviceNameInput = document.getElementById('t08-new-device-name');
  var manageStatusEl = document.getElementById('t08-manage-status');
  var manageCloseBtn = manageModal ? manageModal.querySelector('[data-close]') : null;

  if (!lockedEl || !unlockedEl || !loginBtn) return;

  var SUCCESS_STATUS_MS = 2600;

  // Success messages ("수정했습니다." etc.) auto-clear after a few seconds,
  // like a toast, so they don't sit on screen forever; error messages stay
  // until the next action overwrites them or the modal is closed (see
  // clearStatus / the modal close handlers below).
  function setStatus(el, message, tone) {
    if (!el) return;
    if (el._t08ClearTimer) {
      clearTimeout(el._t08ClearTimer);
      el._t08ClearTimer = null;
    }
    el.textContent = message || '';
    el.classList.remove('t08-status-error', 't08-status-info', 't08-status-success');
    if (tone) el.classList.add('t08-status-' + tone);
    if (tone === 'success') {
      el._t08ClearTimer = setTimeout(function () {
        setStatus(el, '', null);
      }, SUCCESS_STATUS_MS);
    }
  }

  function friendlyError(err, context) {
    var name = err && err.name;
    if (name === 'NotAllowedError') {
      return context === 'register'
        ? '패스키 등록을 취소했거나 시간이 초과되었습니다.'
        : '패스키 로그인을 취소했거나 시간이 초과되었습니다.';
    }
    if (name === 'InvalidStateError') {
      return '이미 이 기기에 등록된 패스키입니다.';
    }
    if (name === 'SecurityError') {
      return 'HTTPS 또는 도메인(origin) 설정 문제로 패스키를 사용할 수 없습니다.';
    }
    if (name === 'NotSupportedError') {
      return '이 브라우저 또는 기기는 패스키를 지원하지 않습니다.';
    }
    return '요청 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
  }

  function fetchJson(url, options) {
    var opts = Object.assign({ headers: { 'Content-Type': 'application/json' } }, options);
    return fetch(url, opts).then(function (res) {
      return res
        .json()
        .catch(function () {
          return null;
        })
        .then(function (body) {
          return { ok: res.ok, status: res.status, body: body || {} };
        });
    });
  }

  function showUnlocked(displayName) {
    lockedEl.hidden = true;
    unlockedEl.hidden = false;
    if (welcomeEl) welcomeEl.textContent = displayName + '님, 환영합니다.';
  }

  function showLocked() {
    lockedEl.hidden = false;
    unlockedEl.hidden = true;
    resetItemEditingState();
  }

  // Must match the server-side limits in api/t08/_lib/privateItems.js —
  // this is only a client-side head start (a nicer error before the round
  // trip); the server re-checks everything regardless.
  var FIELD_LIMITS = { title: 200, category: 60, content: 8000 };

  // All state for the items list lives here, not scattered across the DOM:
  // the list is always rebuilt from latestItems + which id (if any) is
  // being edited, so the rendered cards can never drift from server data.
  var latestItems = [];
  var editingItemId = null;
  var creatingNew = false;

  function resetItemEditingState() {
    latestItems = [];
    editingItemId = null;
    creatingNew = false;
  }

  function serverErrorMessage(status, code) {
    var map = {
      title_required: '제목을 입력해주세요.',
      title_too_long: '제목이 너무 깁니다 (' + FIELD_LIMITS.title + '자 이하).',
      category_required: '카테고리를 입력해주세요.',
      category_too_long: '카테고리가 너무 깁니다 (' + FIELD_LIMITS.category + '자 이하).',
      content_required: '내용을 입력해주세요.',
      content_too_long: '내용이 너무 깁니다 (' + FIELD_LIMITS.content + '자 이하).',
      not_authenticated: '로그인이 만료되었습니다. 다시 로그인해주세요.',
      not_found: '이미 삭제되었거나 접근할 수 없는 기록입니다.',
    };
    if (code && map[code]) return map[code];
    if (status === 401) return '로그인이 만료되었습니다. 다시 로그인해주세요.';
    return '저장하지 못했습니다. 잠시 후 다시 시도해주세요.';
  }

  function validateItemFields(fields) {
    var title = (fields.title || '').trim();
    var category = (fields.category || '').trim();
    var content = (fields.content || '').trim();
    if (!title) return '제목을 입력해주세요.';
    if (title.length > FIELD_LIMITS.title) return serverErrorMessage(null, 'title_too_long');
    if (!category) return '카테고리를 입력해주세요.';
    if (category.length > FIELD_LIMITS.category) return serverErrorMessage(null, 'category_too_long');
    if (!content) return '내용을 입력해주세요.';
    if (content.length > FIELD_LIMITS.content) return serverErrorMessage(null, 'content_too_long');
    return null;
  }

  function buildItemView(item) {
    var li = document.createElement('li');
    li.className = 't08-item';

    var head = document.createElement('div');
    head.className = 't08-item-head';
    var h3 = document.createElement('h3');
    h3.textContent = item.title;
    var cat = document.createElement('span');
    cat.className = 't08-item-category';
    cat.textContent = item.category;
    head.appendChild(h3);
    head.appendChild(cat);

    var p = document.createElement('p');
    p.textContent = item.content;

    var updated = document.createElement('p');
    updated.className = 't08-item-updated';
    updated.textContent = '수정: ' + formatDate(item.updated_at);

    var actions = document.createElement('div');
    actions.className = 't08-item-actions';

    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 't08-item-edit';
    editBtn.textContent = '수정';
    editBtn.setAttribute('aria-label', item.title + ' 수정');
    editBtn.addEventListener('click', function () {
      creatingNew = false;
      editingItemId = item.id;
      setStatus(itemsStatusEl, '', null);
      renderItems();
    });

    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 't08-item-delete';
    delBtn.textContent = '삭제';
    delBtn.setAttribute('aria-label', item.title + ' 삭제');
    delBtn.addEventListener('click', function () {
      confirmDeleteItem(item);
    });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    li.appendChild(head);
    li.appendChild(p);
    li.appendChild(updated);
    li.appendChild(actions);
    return li;
  }

  function buildItemForm(item) {
    var li = document.createElement('li');
    li.className = 't08-item t08-item-editing';

    var form = document.createElement('div');
    form.className = 't08-item-form';

    var titleLabel = document.createElement('label');
    titleLabel.textContent = '제목';
    var titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.maxLength = FIELD_LIMITS.title;
    titleInput.value = item ? item.title : '';
    titleLabel.appendChild(titleInput);

    var categoryLabel = document.createElement('label');
    categoryLabel.textContent = '카테고리';
    var categoryInput = document.createElement('input');
    categoryInput.type = 'text';
    categoryInput.maxLength = FIELD_LIMITS.category;
    categoryInput.value = item ? item.category : '';
    categoryLabel.appendChild(categoryInput);

    var contentLabel = document.createElement('label');
    contentLabel.textContent = '내용';
    var contentInput = document.createElement('textarea');
    contentInput.maxLength = FIELD_LIMITS.content;
    contentInput.value = item ? item.content : '';
    contentLabel.appendChild(contentInput);

    var formStatus = document.createElement('p');
    formStatus.className = 't08-item-status';
    formStatus.setAttribute('role', 'status');
    formStatus.setAttribute('aria-live', 'polite');

    var actions = document.createElement('div');
    actions.className = 't08-item-form-actions';

    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 't08-btn t08-btn-primary';
    saveBtn.textContent = '저장';

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 't08-btn t08-btn-ghost';
    cancelBtn.textContent = '취소';

    cancelBtn.addEventListener('click', function () {
      if (!item) creatingNew = false;
      else editingItemId = null;
      renderItems();
    });

    saveBtn.addEventListener('click', function () {
      saveItem(
        item,
        { title: titleInput.value, category: categoryInput.value, content: contentInput.value },
        { saveBtn: saveBtn, cancelBtn: cancelBtn, statusEl: formStatus }
      );
    });

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);

    form.appendChild(titleLabel);
    form.appendChild(categoryLabel);
    form.appendChild(contentLabel);
    form.appendChild(formStatus);
    form.appendChild(actions);

    li.appendChild(form);
    return li;
  }

  function renderItems() {
    if (!itemsEl) return;
    itemsEl.innerHTML = '';

    if (addItemBtn) addItemBtn.disabled = creatingNew;

    if (creatingNew) {
      itemsEl.appendChild(buildItemForm(null));
    }

    if (latestItems.length === 0 && !creatingNew) {
      var empty = document.createElement('li');
      empty.className = 't08-item-empty';
      empty.textContent = '아직 등록된 기록이 없습니다.';
      itemsEl.appendChild(empty);
      return;
    }

    latestItems.forEach(function (item) {
      itemsEl.appendChild(item.id === editingItemId ? buildItemForm(item) : buildItemView(item));
    });
  }

  // Always re-fetches from the server after any mutation, rather than
  // patching the DOM optimistically — the list on screen must reflect
  // what is actually in the database, never a client-only guess.
  function loadPrivateItems() {
    return fetchJson('/api/t08/private-items').then(function (result) {
      if (result.ok) {
        latestItems = result.body.items || [];
        renderItems();
      }
    });
  }

  function saveItem(item, fields, ui) {
    var clientError = validateItemFields(fields);
    if (clientError) {
      setStatus(ui.statusEl, clientError, 'error');
      return;
    }

    setStatus(ui.statusEl, '저장 중...', 'info');
    ui.saveBtn.disabled = true;
    ui.cancelBtn.disabled = true;

    var payload = {
      title: fields.title.trim(),
      category: fields.category.trim(),
      content: fields.content.trim(),
    };
    var isCreate = !item;
    var request = isCreate
      ? fetchJson('/api/t08/private-items', { method: 'POST', body: JSON.stringify(payload) })
      : fetchJson('/api/t08/private-items/' + encodeURIComponent(item.id), {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });

    request
      .then(function (result) {
        if (!result.ok) {
          throw serverErrorMessage(result.status, result.body && result.body.error);
        }
        creatingNew = false;
        editingItemId = null;
        setStatus(itemsStatusEl, isCreate ? '새 기록을 추가했습니다.' : '수정했습니다.', 'success');
        return loadPrivateItems();
      })
      .catch(function (message) {
        setStatus(ui.statusEl, typeof message === 'string' ? message : serverErrorMessage(), 'error');
        ui.saveBtn.disabled = false;
        ui.cancelBtn.disabled = false;
      });
  }

  function confirmDeleteItem(item) {
    var ok = window.confirm('"' + item.title + '" 기록을 삭제할까요? 이 작업은 되돌릴 수 없습니다.');
    if (!ok) return;

    setStatus(itemsStatusEl, '삭제 중...', 'info');
    fetchJson('/api/t08/private-items/' + encodeURIComponent(item.id), { method: 'DELETE' })
      .then(function (result) {
        if (!result.ok) {
          throw serverErrorMessage(result.status, result.body && result.body.error);
        }
        setStatus(itemsStatusEl, '삭제했습니다.', 'success');
        return loadPrivateItems();
      })
      .catch(function (message) {
        setStatus(itemsStatusEl, typeof message === 'string' ? message : serverErrorMessage(), 'error');
      });
  }

  function checkSession() {
    return fetchJson('/api/t08/auth/session').then(function (result) {
      if (result.ok && result.body.authenticated) {
        showUnlocked(result.body.displayName);
        return loadPrivateItems();
      }
      showLocked();
    });
  }

  function login() {
    if (typeof swa.browserSupportsWebAuthn === 'function' && !swa.browserSupportsWebAuthn()) {
      setStatus(statusEl, '이 브라우저는 패스키(WebAuthn)를 지원하지 않습니다.', 'error');
      return;
    }
    setStatus(statusEl, '패스키 확인 중...', 'info');
    loginBtn.disabled = true;

    fetchJson('/api/t08/auth/options', { method: 'POST' })
      .then(function (optionsRes) {
        if (!optionsRes.ok) throw { handled: true, message: '로그인을 시작할 수 없습니다. 잠시 후 다시 시도해주세요.' };
        return swa.startAuthentication({ optionsJSON: optionsRes.body });
      })
      .then(function (authResponse) {
        return fetchJson('/api/t08/auth/verify', {
          method: 'POST',
          body: JSON.stringify({ response: authResponse }),
        });
      })
      .then(function (verifyRes) {
        if (!verifyRes.ok) {
          throw { handled: true, message: '패스키 인증에 실패했습니다. 등록되지 않은 패스키이거나 만료된 요청입니다.' };
        }
        setStatus(statusEl, '', null);
        return checkSession();
      })
      .catch(function (err) {
        setStatus(statusEl, err && err.handled ? err.message : friendlyError(err, 'login'), 'error');
      })
      .finally(function () {
        loginBtn.disabled = false;
      });
  }

  function logout() {
    fetchJson('/api/t08/auth/logout', { method: 'POST' }).then(function () {
      showLocked();
      setStatus(statusEl, '로그아웃했습니다.', 'success');
    });
  }

  function formatDate(iso) {
    if (!iso) return '없음';
    try {
      return new Date(iso).toLocaleString('ko-KR');
    } catch (e) {
      return iso;
    }
  }

  function loadPasskeys() {
    return fetchJson('/api/t08/passkeys').then(function (result) {
      if (!result.ok || !passkeyListEl) return;
      var passkeys = result.body.passkeys || [];
      passkeyListEl.innerHTML = '';
      passkeys.forEach(function (pk) {
        var li = document.createElement('li');
        li.className = 't08-passkey-row';

        var info = document.createElement('div');
        var name = document.createElement('strong');
        name.textContent = pk.deviceName;
        var meta = document.createElement('p');
        meta.className = 't08-passkey-meta';
        meta.textContent = '등록: ' + formatDate(pk.createdAt) + ' · 마지막 사용: ' + formatDate(pk.lastUsedAt);
        info.appendChild(name);
        info.appendChild(meta);

        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 't08-passkey-delete';
        delBtn.textContent = '삭제';
        var isLast = passkeys.length <= 1;
        delBtn.disabled = isLast;
        if (isLast) delBtn.title = '마지막 남은 패스키는 삭제할 수 없습니다.';
        delBtn.addEventListener('click', function () {
          var ok = window.confirm('"' + pk.deviceName + '" 패스키를 삭제할까요? 이 작업은 되돌릴 수 없습니다.');
          if (!ok) return;
          deletePasskey(pk.id);
        });

        li.appendChild(info);
        li.appendChild(delBtn);
        passkeyListEl.appendChild(li);
      });
    });
  }

  function deletePasskey(id) {
    setStatus(manageStatusEl, '삭제 중...', 'info');
    fetchJson('/api/t08/passkeys/' + encodeURIComponent(id), { method: 'DELETE' }).then(function (result) {
      if (result.ok) {
        setStatus(manageStatusEl, '삭제했습니다.', 'success');
        return loadPasskeys();
      }
      if (result.status === 409) {
        setStatus(manageStatusEl, '마지막 패스키는 삭제할 수 없습니다. 새 패스키를 먼저 등록해 주세요.', 'error');
        return;
      }
      setStatus(manageStatusEl, '삭제하지 못했습니다.', 'error');
    });
  }

  function addPasskey() {
    setStatus(manageStatusEl, '새 패스키 등록 중...', 'info');
    addPasskeyBtn.disabled = true;

    fetchJson('/api/t08/passkeys/register/options', { method: 'POST' })
      .then(function (optionsRes) {
        if (!optionsRes.ok) throw { handled: true, message: '등록을 시작할 수 없습니다.' };
        return swa.startRegistration({ optionsJSON: optionsRes.body });
      })
      .then(function (regResponse) {
        var deviceName = (newDeviceNameInput && newDeviceNameInput.value.trim()) || '새 패스키';
        return fetchJson('/api/t08/passkeys/register/verify', {
          method: 'POST',
          body: JSON.stringify({ response: regResponse, deviceName: deviceName }),
        });
      })
      .then(function (verifyRes) {
        if (!verifyRes.ok) throw { handled: true, message: '패스키 등록에 실패했습니다.' };
        setStatus(manageStatusEl, '패스키를 등록했습니다.', 'success');
        if (newDeviceNameInput) newDeviceNameInput.value = '';
        return loadPasskeys();
      })
      .catch(function (err) {
        setStatus(manageStatusEl, err && err.handled ? err.message : friendlyError(err, 'register'), 'error');
      })
      .finally(function () {
        addPasskeyBtn.disabled = false;
      });
  }

  if (openBtn && archiveModal && typeof archiveModal.showModal === 'function') {
    openBtn.addEventListener('click', function () {
      archiveModal.showModal();
    });
  }
  if (archiveCloseBtn && archiveModal) {
    archiveCloseBtn.addEventListener('click', function () {
      archiveModal.close();
    });
  }
  if (archiveModal) {
    archiveModal.addEventListener('click', function (event) {
      if (event.target === archiveModal) archiveModal.close();
    });
    // Covers every way the dialog can close (button, backdrop click, Esc) —
    // a lingering error message shouldn't still be there next time it opens.
    archiveModal.addEventListener('close', function () {
      setStatus(statusEl, '', null);
      setStatus(itemsStatusEl, '', null);
    });
  }

  loginBtn.addEventListener('click', login);
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
  if (addItemBtn) {
    addItemBtn.addEventListener('click', function () {
      if (creatingNew) return;
      editingItemId = null;
      creatingNew = true;
      setStatus(itemsStatusEl, '', null);
      renderItems();
      var firstInput = itemsEl && itemsEl.querySelector('.t08-item-editing input');
      if (firstInput) firstInput.focus();
    });
  }
  if (manageBtn && manageModal) {
    manageBtn.addEventListener('click', function () {
      setStatus(manageStatusEl, '', null);
      manageModal.showModal();
      loadPasskeys();
    });
  }
  if (manageCloseBtn) {
    manageCloseBtn.addEventListener('click', function () {
      manageModal.close();
    });
  }
  if (manageModal) {
    manageModal.addEventListener('click', function (event) {
      if (event.target === manageModal) manageModal.close();
    });
    manageModal.addEventListener('close', function () {
      setStatus(manageStatusEl, '', null);
    });
  }
  if (addPasskeyBtn) addPasskeyBtn.addEventListener('click', addPasskey);

  checkSession();
})();
