/**
 * 知识配置平台 - 公共脚本
 * 登录检查、导航高亮、Toast 消息、Confirm 确认、用户模块
 */
(function () {
  'use strict';

  var currentPage = window.location.pathname.split('/').pop() || 'index.html';
  
  // ====================== 登录检查 ======================
  // 非登录页需要检查登录状态
  if (currentPage !== 'login.html') {
    if (typeof AuthModule !== 'undefined' && !AuthModule.isLoggedIn()) {
      // 带上最近尝试登录的用户名，登录页据此还原该账号的失败/锁定提示
      var lastUsername = typeof AuthModule.getLastLoginUsername === 'function'
        ? AuthModule.getLastLoginUsername()
        : '';
      var loginUrl = 'login.html';
      if (lastUsername) {
        loginUrl += '?username=' + encodeURIComponent(lastUsername);
      }
      window.location.href = loginUrl;
      return;
    }
  }

  // ====================== 导航高亮 ======================
  var path = window.location.pathname.replace(/^\//, '').replace(/\.html$/, '') || 'index';
  document.querySelectorAll('.nav-item').forEach(function (el) {
    var href = (el.getAttribute('href') || '').replace(/\.html$/, '') || 'index';
    if (href === path) el.classList.add('router-active');
    else el.classList.remove('router-active');
  });

  // ====================== 用户信息与退出按钮 ======================
  function initUserHeader() {
    if (currentPage === 'login.html') return;
    if (typeof AuthModule === 'undefined') return;

    var user = AuthModule.getCurrentUser();
    if (!user) return;

    var header = document.querySelector('.app-header');
    if (!header) return;

    // 检查是否已添加用户信息
    if (header.querySelector('.user-info')) return;

    // 创建用户信息区域
    var userInfo = document.createElement('div');
    userInfo.className = 'user-info ml-auto flex items-center gap-3';
    userInfo.innerHTML = 
      '<span class="text-sm text-slate-500">欢迎，<span class="font-medium text-slate-700">' + (user.name || user.username) + '</span></span>' +
      '<button type="button" id="logoutBtn" class="logout-btn inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors">' +
        '<span class="iconify" data-icon="lucide:log-out" data-width="16" data-height="16"></span>' +
        '退出' +
      '</button>';
    header.appendChild(userInfo);

    // 绑定退出事件
    var logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        Confirm.show('确定要退出登录吗？', function () {
          AuthModule.logout();
          Toast.show('已退出登录', 'success');
          setTimeout(function () {
            window.location.href = 'login.html';
          }, 500);
        });
      });
    }
  }

  // DOM加载完成后初始化用户头部
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUserHeader);
  } else {
    initUserHeader();
  }

  /** Toast 容器 */
  function getToastContainer() {
    var id = 'knowledge-platform-toast';
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = 'toast-container';
      document.body.appendChild(el);
    }
    return el;
  }

  /**
   * 展示提示消息（替代 alert）
   * @param {string} msg - 文案
   * @param {string} type - 'error' | 'success' | 'info'
   */
  window.Toast = {
    show: function (msg, type) {
      type = type || 'info';
      var container = getToastContainer();
      var item = document.createElement('div');
      item.className = 'toast-item toast-' + type;
      item.textContent = msg;
      container.appendChild(item);
      setTimeout(function () {
        if (item.parentNode) item.parentNode.removeChild(item);
      }, 2800);
    },
  };

  /**
   * 确认框（替代 confirm）
   * @param {string} msg - 提示文案
   * @param {function} onConfirm - 点击确定回调
   * @param {function} onCancel - 点击取消回调（可选）
   */
  window.Confirm = {
    show: function (msg, onConfirm, onCancel) {
      var overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      var title = document.createElement('div');
      title.className = 'confirm-title text-obsidian';
      title.textContent = msg || '确定执行？';
      var actions = document.createElement('div');
      actions.className = 'confirm-actions';
      var btnCancel = document.createElement('button');
      btnCancel.type = 'button';
      btnCancel.className = 'btn-secondary confirm-cancel';
      btnCancel.textContent = '取消';
      var btnOk = document.createElement('button');
      btnOk.type = 'button';
      btnOk.className = 'btn-primary confirm-ok';
      btnOk.textContent = '确定';
      actions.appendChild(btnCancel);
      actions.appendChild(btnOk);
      var box = document.createElement('div');
      box.className = 'confirm-box premium-card';
      box.appendChild(title);
      box.appendChild(actions);
      overlay.appendChild(box);
      function close() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
      btnOk.addEventListener('click', function () {
        close();
        if (typeof onConfirm === 'function') onConfirm();
      });
      btnCancel.addEventListener('click', function () {
        close();
        if (typeof onCancel === 'function') onCancel();
      });
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) {
          close();
          if (typeof onCancel === 'function') onCancel();
        }
      });
      document.body.appendChild(overlay);
    },
  };
})();
