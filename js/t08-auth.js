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
  var logoutBtn = document.getElementById('t08-logout-btn');
  var manageBtn = document.getElementById('t08-manage-btn');
  var manageModal = document.getElementById('t08-manage-modal');
  var passkeyListEl = document.getElementById('t08-passkey-list');
  var addPasskeyBtn = document.getElementById('t08-add-passkey-btn');
  var newDeviceNameInput = document.getElementById('t08-new-device-name');
  var manageStatusEl = document.getElementById('t08-manage-status');
  var manageCloseBtn = manageModal ? manageModal.querySelector('[data-close]') : null;

  if (!lockedEl || !unlockedEl || !loginBtn) return;

  function setStatus(el, message, tone) {
    if (!el) return;
    el.textContent = message || '';
    el.classList.remove('t08-status-error', 't08-status-info');
    if (tone) el.classList.add('t08-status-' + tone);
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
  }

  function renderItems(items) {
    if (!itemsEl) return;
    itemsEl.innerHTML = '';
    items.forEach(function (item) {
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

      li.appendChild(head);
      li.appendChild(p);
      itemsEl.appendChild(li);
    });
  }

  function loadPrivateItems() {
    return fetchJson('/api/t08/private-items').then(function (result) {
      if (result.ok) renderItems(result.body.items || []);
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
      setStatus(statusEl, '로그아웃했습니다.', 'info');
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
        setStatus(manageStatusEl, '삭제했습니다.', 'info');
        return loadPasskeys();
      }
      if (result.status === 409) {
        setStatus(manageStatusEl, '마지막 남은 패스키는 삭제할 수 없습니다. 삭제하면 계정에 다시 접근할 수 없습니다.', 'error');
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
        setStatus(manageStatusEl, '패스키를 등록했습니다.', 'info');
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
  }

  loginBtn.addEventListener('click', login);
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
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
  }
  if (addPasskeyBtn) addPasskeyBtn.addEventListener('click', addPasskey);

  checkSession();
})();
