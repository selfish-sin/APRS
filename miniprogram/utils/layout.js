function getSystemInfo() {
  try {
    if (typeof wx.getWindowInfo === 'function') {
      return wx.getWindowInfo();
    }
  } catch (error) {
    // Fall through to the legacy API below.
  }
  try {
    return wx.getSystemInfoSync();
  } catch (error) {
    return {
      statusBarHeight: 20,
      screenHeight: 812,
      windowWidth: 375,
      windowHeight: 812,
      safeArea: { bottom: 812 },
    };
  }
}

function getLayout() {
  const info = getSystemInfo();
  const statusBarHeight = Number(info.statusBarHeight) || 20;
  let navBarHeight = 44;

  try {
    const menu = wx.getMenuButtonBoundingClientRect();
    if (menu && menu.height && menu.top) {
      navBarHeight = Math.max(40, (menu.top - statusBarHeight) * 2 + menu.height);
    }
  } catch (error) {
    // Keep the conventional 44px navigation height.
  }

  const screenHeight = Number(info.screenHeight || info.windowHeight) || 812;
  const safeArea = info.safeArea || {};
  const safeBottom = Math.max(0, screenHeight - (Number(safeArea.bottom) || screenHeight));

  return {
    statusBarHeight,
    navBarHeight,
    topInset: statusBarHeight + navBarHeight,
    safeBottom: Math.round(safeBottom),
    windowWidth: Number(info.windowWidth) || 375,
    windowHeight: Number(info.windowHeight) || 812,
    screenHeight,
  };
}

function capsuleGap() {
  try {
    const menu = wx.getMenuButtonBoundingClientRect();
    const info = getSystemInfo();
    if (menu && menu.left) {
      return Math.max(0, (Number(info.windowWidth) || 375) - menu.left + 8);
    }
  } catch (error) {
    return 96;
  }
  return 96;
}

module.exports = {
  getLayout,
  capsuleGap,
};
