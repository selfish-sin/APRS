const { getLayout } = require('../../utils/layout');
const feedback = require('../../utils/feedback');

Component({
  properties: {
    title: {
      type: String,
      value: '',
    },
    back: {
      type: Boolean,
      value: true,
    },
    fallback: {
      type: String,
      value: '/pages/board/index',
    },
  },

  data: {
    layout: {
      statusBarHeight: 20,
      navBarHeight: 44,
      topInset: 64,
    },
  },

  lifetimes: {
    attached() {
      this.setData({ layout: getLayout() });
    },
  },

  pageLifetimes: {
    resize() {
      this.setData({ layout: getLayout() });
    },
  },

  methods: {
    handleBack() {
      feedback.navigateBack(
        this.properties.fallback || '/pages/board/index'
      );
    },
  },
});
