const constants = require('../../utils/constants');
const accounts = require('../../services/accounts');
const sessionService = require('../../services/session');
const taskService = require('../../services/task-service');
const { getLayout } = require('../../utils/layout');
const dateUtil = require('../../utils/date');
const feedback = require('../../utils/feedback');

Page({
  data: {
    layout: {
      safeBottom: 0,
    },
    user: null,
    stages: constants.STAGES,
    processes: constants.getProcessesForStage('pre'),
    priorities: constants.PRIORITIES,
    employees: [],
    selectedStage: 'pre',
    selectedCategory: 'planning',
    selectedPriority: 'normal',
    title: '',
    batch: '',
    description: '',
    dueDate: '',
    minDate: '',
    maxDate: '',
    reward: 100,
    assignMode: 'pool',
    selectedAssigneeId: '',
    submitting: false,
  },

  onLoad() {
    const session = sessionService.getSession();
    if (!session) {
      wx.reLaunch({ url: '/pages/login/index' });
      return;
    }
    if (session.user.role !== constants.ROLES.ADMIN) {
      feedback.error('仅部门管理员可以张贴委托');
      feedback.navigateBack('/pages/board/index');
      return;
    }

    const employees = accounts.listWorkers().map((account) =>
      Object.assign({}, account, {
        initial: constants.avatarText(account.nickname || account.name),
      })
    );

    this.session = session;
    this.setData({
      layout: getLayout(),
      user: session.user,
      employees,
      selectedAssigneeId: employees.length ? employees[0].id : '',
      dueDate: dateUtil.addDaysKey(3),
      minDate: dateUtil.dateKey(new Date()),
      maxDate: dateUtil.addDaysKey(365),
    });
  },

  onResize() {
    this.setData({ layout: getLayout() });
  },

  handleInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) {
      return;
    }
    this.setData({ [field]: event.detail.value });
  },

  handleStage(event) {
    const stage = event.currentTarget.dataset.key;
    if (!stage || stage === this.data.selectedStage) {
      return;
    }
    const processes = constants.getProcessesForStage(stage);
    feedback.vibrate();
    this.setData({
      selectedStage: stage,
      processes,
      selectedCategory: processes[0].key,
    });
  },

  handleCategory(event) {
    const key = event.currentTarget.dataset.key;
    if (key && key !== this.data.selectedCategory) {
      feedback.vibrate();
      this.setData({ selectedCategory: key });
    }
  },

  handlePriority(event) {
    const key = event.currentTarget.dataset.key;
    if (key && key !== this.data.selectedPriority) {
      feedback.vibrate();
      this.setData({ selectedPriority: key });
    }
  },

  handleDateChange(event) {
    this.setData({ dueDate: event.detail.value });
  },

  handleStep(event) {
    const delta = Number(event.currentTarget.dataset.delta) || 0;
    const next = Math.min(500, Math.max(20, this.data.reward + delta));
    if (next !== this.data.reward) {
      feedback.vibrate();
      this.setData({ reward: next });
    }
  },

  handleAssignMode(event) {
    const mode = event.currentTarget.dataset.mode;
    if (!mode || mode === this.data.assignMode) {
      return;
    }
    feedback.vibrate();
    this.setData({ assignMode: mode });
  },

  handleAssignee(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === this.data.selectedAssigneeId) {
      return;
    }
    feedback.vibrate();
    this.setData({ selectedAssigneeId: id });
  },

  async handleSubmit() {
    if (this.data.submitting) {
      return;
    }
    const title = this.data.title.trim();
    if (title.length < 2) {
      feedback.error('请先填写委托标题');
      return;
    }
    if (!this.data.dueDate) {
      feedback.error('请选择交付期限');
      return;
    }
    if (this.data.assignMode === 'assign' && !this.data.selectedAssigneeId) {
      feedback.error('请选择要指派的工作者');
      return;
    }

    this.setData({ submitting: true });
    try {
      await taskService.createTask(
        {
          title,
          description: this.data.description,
          category: this.data.selectedCategory,
          priority: this.data.selectedPriority,
          batch: this.data.batch,
          dueDate: this.data.dueDate,
          reward: this.data.reward,
          assigneeId:
            this.data.assignMode === 'assign'
              ? this.data.selectedAssigneeId
              : '',
        },
        this.session.user
      );
      feedback.vibrate();
      wx.showToast({
        title: this.data.assignMode === 'assign' ? '委托已指派' : '委托已张贴',
        icon: 'success',
        duration: 1200,
      });
      feedback.navigateBack('/pages/board/index');
    } catch (error) {
      this.setData({ submitting: false });
      feedback.error(error.message || '张贴失败，请稍后重试');
    }
  },

  handleCancel() {
    feedback.navigateBack('/pages/board/index');
  },
});
