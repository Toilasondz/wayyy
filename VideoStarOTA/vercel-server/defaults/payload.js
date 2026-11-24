/**
 * VideoStarOTA Remote Feature Payload (chạy trong JavaScriptCore của dylib iOS)
 * Khi bạn sửa tệp này trên Web Admin Vercel và bấm "Xuất bản OTA",
 * tất cả app Video Star sẽ tự tải về, kiểm tra SHA-256 và chạy ngay lập tức.
 */
(function () {
  var info = VST.getAppInfo();
  var cfg = VST.getConfig() || {};

  VST.log('[OTA] Khởi động payload v' + info.otaVersion + ' trên Video Star ' + info.appVersion);

  // Tự động bật bắt nội dung popup gốc (CustomPopup -doTheShow) nếu cấu hình cho phép
  if (cfg.features && cfg.features.autoCapturePopup) {
    VST.hookPopupCapture(true);
    VST.log('[OTA] Đã bật bắt nội dung CustomPopup (_attributedMessage)');
  }

  // Callback được dylib Objective-C gọi tự động khi CustomPopup hiện ra
  globalThis.onPopupCaptured = function (title, text) {
    VST.log('[Popup] ' + title + ' (' + (text ? text.length : 0) + ' ký tự)');
    VST.storageSet('last_popup_title', title || '');
    VST.storageSet('last_popup_text', text || '');
    if (cfg.features && cfg.features.autoCopyPopup && text) {
      VST.copyToClipboard(text);
      VST.toast('Đã sao chép nội dung lớp gốc!');
    }
  };

  // Hàm xử lý lệnh gửi từ giao diện WKWebView (panel.html)
  globalThis.onPanelAction = function (action, payload) {
    VST.log('[Panel Action] ' + action);

    if (action === 'ping') {
      VST.toast('Kết nối OTA đang hoạt động (v' + info.otaVersion + ')');
      return { ok: true, version: info.otaVersion, appVersion: info.appVersion };
    }

    if (action === 'toggle_delay_mode') {
      var enabled = !!(payload && payload.enabled);
      VST.storageSet('delay_mode', enabled ? '1' : '0');
      VST.toast(enabled ? 'Đã BẬT Delay Mode (5s / 10 cảnh)' : 'Đã TẮT Delay Mode (0ms)');
      return { ok: true, delayMode: enabled };
    }

    if (action === 'inspect_classes') {
      var map = (cfg.classMap && (cfg.classMap[info.appVersion] || cfg.classMap.default)) || {};
      var report = {};
      for (var key in map) {
        if (Object.prototype.hasOwnProperty.call(map, key)) {
          report[key] = VST.hasClass(map[key]);
        }
      }
      return { ok: true, appVersion: info.appVersion, report: report };
    }

    if (action === 'get_last_popup') {
      return {
        ok: true,
        title: VST.storageGet('last_popup_title') || '',
        text: VST.storageGet('last_popup_text') || ''
      };
    }

    if (action === 'check_update') {
      VST.checkUpdate();
      return { ok: true };
    }

    return { ok: false, error: 'Lệnh chưa được định nghĩa: ' + action };
  };

  if (cfg.welcomeToast) {
    VST.toast(cfg.welcomeToast + ' (v' + info.otaVersion + ')');
  }
})();
