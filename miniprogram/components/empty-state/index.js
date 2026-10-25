Component({
  properties: {
    title: {
      type: String,
      value: '告示栏空空如也',
    },
    description: {
      type: String,
      value: '换个筛选条件，或等待新的委托卷轴。',
    },
    actionLabel: {
      type: String,
      value: '',
    },
  },

  methods: {
    handleAction() {
      this.triggerEvent('action');
    },
  },
});
