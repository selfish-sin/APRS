Component({
  properties: {
    task: {
      type: Object,
      value: {},
    },
    index: {
      type: Number,
      value: 0,
    },
  },

  methods: {
    handleOpen() {
      this.triggerEvent('open', { id: this.data.task.id });
    },

    handleAction(event) {
      const action = this.data.task.action;
      if (!action) {
        return;
      }
      this.triggerEvent('action', {
        id: this.data.task.id,
        action,
      });
    },
  },
});
