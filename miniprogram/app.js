const { getLayout } = require('./utils/layout');

App({
  globalData: {
    version: '0.11.7',
    layout: null,
  },

  onLaunch() {
    this.globalData.layout = getLayout();
  },
});
