function vibrate() {
  try {
    if (typeof wx.vibrateShort === 'function') {
      wx.vibrateShort({ type: 'light' });
    }
  } catch (error) {
    // Haptics are optional and unsupported on some desktop clients.
  }
}

function toast(title, icon) {
  try {
    wx.showToast({
      title,
      icon: icon || 'none',
      duration: 1800,
      mask: false,
    });
  } catch (error) {
    // A missing UI context should never break a task action.
  }
}

function success(title) {
  toast(title, 'success');
}

function error(message) {
  toast(message || '操作失败，请重试', 'none');
}

function confirm(options) {
  const config = options || {};
  return new Promise((resolve) => {
    const modal = {
      title: config.title || '确认操作',
      content: config.content || '',
      confirmText: config.confirmText || '确认',
      cancelText: config.cancelText || '取消',
      confirmColor: config.confirmColor || '#A17826',
      success(result) {
        resolve({
          confirm: !!result.confirm,
          content: result.content || '',
        });
      },
      fail() {
        toast('确认框打开失败，请重试');
        resolve({ confirm: false, content: '' });
      },
    };
    if (config.editable) {
      modal.editable = true;
      modal.placeholderText = config.placeholderText || '';
    }
    try {
      wx.showModal(modal);
    } catch (error) {
      toast('确认框打开失败，请重试');
      resolve({ confirm: false, content: '' });
    }
  });
}

function fallbackNavigate(url) {
  const tabs = [
    '/pages/board/index',
    '/pages/ranking/index',
    '/pages/profile/index',
  ];
  if (tabs.indexOf(url) >= 0) {
    wx.switchTab({
      url,
      fail: () => wx.reLaunch({ url }),
    });
    return;
  }
  wx.redirectTo({
    url,
    fail: () => wx.reLaunch({ url }),
  });
}

function navigateBack(fallback) {
  const pages = getCurrentPages();
  if (pages.length > 1) {
    wx.navigateBack({
      delta: 1,
      fail: () => fallbackNavigate(fallback || '/pages/board/index'),
    });
    return;
  }
  fallbackNavigate(fallback || '/pages/board/index');
}

module.exports = {
  vibrate,
  toast,
  success,
  error,
  confirm,
  navigateBack,
};
