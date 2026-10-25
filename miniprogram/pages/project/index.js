const constants = require('../../utils/constants');
const sessionService = require('../../services/session');
const projectService = require('../../services/project-service');
const taskService = require('../../services/task-service');
const { getLayout } = require('../../utils/layout');
const dateUtil = require('../../utils/date');
const feedback = require('../../utils/feedback');

Page({
  data: {
    layout: {
      safeBottom: 0,
    },
    isEdit: false,
    isArchived: false,
    archiveStats: {
      recruiting: 0,
      inProgress: 0,
      inReview: 0,
      done: 0,
      total: 0,
    },
    projectId: '',
    status: 'draft',
    name: '',
    code: '',
    description: '',
    deadline: '',
    minDate: '',
    maxDate: '',
    tasks: [],
    stageGroups: [],
    enabledCount: 0,
    totalAmount: 0,
    showEditor: false,
    editingKey: '',
    editingTask: null,
    editingTotal: 0,
    publishing: false,
    loading: true,
  },

  onLoad(options) {
    const session = sessionService.getSession();
    if (!session) {
      wx.reLaunch({ url: '/pages/login/index' });
      return;
    }
    if (session.role !== constants.ROLES.ADMIN) {
      feedback.error('仅部门管理员可以管理项目');
      feedback.navigateBack('/pages/board/index');
      return;
    }
    this.session = session;
    this.setData({
      layout: getLayout(),
      minDate: dateUtil.dateKey(new Date()),
      maxDate: dateUtil.addDaysKey(365),
    });

    const projectId = options && options.id ? options.id : '';
    if (projectId) {
      this.loadProject(projectId);
    } else {
      this.initDraft();
    }
  },

  initDraft() {
    const tasks = projectService.buildDraftTasks();
    this.setData({
      deadline: dateUtil.addDaysKey(30),
      loading: false,
    });
    this.commitTasks(tasks);
  },

  loadProject(projectId) {
    try {
      const result = projectService.getProjectWithTasks(projectId);
      const isArchived = result.project.status === 'archived';
      let tasks = result.tasks.map((task) => projectService.toDraftTask(task));
      if (isArchived) {
        tasks = tasks.map((task) =>
          Object.assign({}, task, {
            editable: false,
            cancellable: false,
          })
        );
      }
      this.setData({
        isEdit: true,
        isArchived,
        archiveStats: result.archiveStats,
        projectId,
        status: result.project.status,
        name: result.project.name,
        code: result.project.code,
        description: result.project.description,
        deadline: result.project.deadline,
        loading: false,
      });
      this.commitTasks(tasks);
    } catch (error) {
      this.setData({ loading: false });
      feedback.error(error.message || '项目加载失败');
      feedback.navigateBack('/pages/projects/index');
    }
  },

  commitTasks(tasks) {
    const list = tasks.slice();
    const stageGroups = constants.STAGES.map((stage) => {
      const stageTasks = list.filter((task) => task.stageKey === stage.key);
      return {
        key: stage.key,
        name: stage.name,
        color: stage.color,
        soft: stage.soft,
        count: stageTasks.length,
        tasks: stageTasks,
      };
    }).filter((group) => group.tasks.length > 0);
    const enabled = list.filter((task) => task.enabled !== false);
    const totalAmount = enabled.reduce(
      (sum, task) => sum + (Number(task.total) || 0),
      0
    );
    this.setData({
      tasks: list,
      stageGroups,
      enabledCount: enabled.length,
      totalAmount,
    });
  },

  handleMetaInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field || this.data.isEdit) {
      return;
    }
    this.setData({ [field]: event.detail.value });
  },

  handleDeadlineChange(event) {
    if (this.data.isEdit) {
      return;
    }
    this.setData({ deadline: event.detail.value });
  },

  handleTaskTap(event) {
    const key = event.currentTarget.dataset.key;
    if (!key) {
      return;
    }
    const task = this.data.tasks.find((item) => item.key === key);
    if (!task) {
      return;
    }
    if (task.status === 'cancelled') {
      feedback.error('已取消的任务不能再修改');
      return;
    }
    if (task.editable === false) {
      feedback.error('已归档项目不能修改任务');
      return;
    }
    feedback.vibrate();
    this.setData({
      editingKey: key,
      editingTask: Object.assign({}, task),
      editingTotal: Number(task.total) || 0,
      showEditor: true,
    });
  },

  async handleTaskCancel(event) {
    if (this.data.isArchived) {
      return;
    }
    const key = event.currentTarget.dataset.key;
    const task = this.data.tasks.find((item) => item.key === key);
    if (!task || !task.taskId) {
      return;
    }
    const result = await feedback.confirm({
      title: '取消这项任务？',
      content: `「${task.title}」将从项目中取消，不再出现在告示栏。已接取的工作者会收到取消通知，项目总赏金会重新计算。`,
      confirmText: '取消任务',
      confirmColor: '#A6402F',
    });
    if (!result.confirm) {
      return;
    }
    wx.showLoading({ title: '取消中', mask: true });
    try {
      const updated = await taskService.cancelTask(
        task.taskId,
        this.session.user
      );
      const nextTask = projectService.toDraftTask(updated);
      const tasks = this.data.tasks.map((item) =>
        item.key === nextTask.key ? nextTask : item
      );
      this.commitTasks(tasks);
      wx.hideLoading();
      feedback.success('任务已取消');
    } catch (error) {
      wx.hideLoading();
      feedback.error(error.message || '任务取消失败');
    }
  },

  handleEditorInput(event) {
    const field = event.currentTarget.dataset.field;
    const task = this.data.editingTask;
    if (!field || !task) {
      return;
    }
    const next = Object.assign({}, task);
    next[field] = event.detail.value;
    if (field === 'quantity') {
      next.quantity = event.detail.value;
    }
    if (field === 'unitPrice') {
      next.unitPrice = event.detail.value;
    }
    const quantity =
      next.unitKey === 'once' ? 1 : Number(next.quantity) || 0;
    const unitPrice = Number(next.unitPrice) || 0;
    this.setData({
      editingTask: next,
      editingTotal: Math.round(quantity * unitPrice),
    });
  },

  handleEditorToggle() {
    if (this.data.isEdit || !this.data.editingTask) {
      return;
    }
    const task = Object.assign({}, this.data.editingTask, {
      enabled: this.data.editingTask.enabled === false,
    });
    feedback.vibrate();
    this.setData({ editingTask: task });
  },

  handleEditorSave() {
    if (this.data.isArchived) {
      return;
    }
    const task = this.data.editingTask;
    if (!task) {
      return;
    }
    const title = String(task.title || '').trim();
    const description = String(task.description || '').trim();
    const quantity =
      task.unitKey === 'once' ? 1 : Number(task.quantity) || 0;
    const unitPrice = Number(task.unitPrice) || 0;

    if (title.length < 1 || title.length > 40) {
      feedback.error('任务标题需要 1 到 40 个字符');
      return;
    }
    if (description.length > 500) {
      feedback.error('任务说明不能超过 500 个字符');
      return;
    }
    if (quantity <= 0) {
      feedback.error('工作量需要大于 0');
      return;
    }
    if (unitPrice < 0) {
      feedback.error('单价不能小于 0');
      return;
    }

    const patch = {
      title,
      description,
      quantity: Math.round(quantity),
      unitPrice: Math.round(unitPrice),
    };

    wx.showLoading({ title: '保存中', mask: true });
    try {
      if (this.data.isEdit) {
        const updated = projectService.updateProjectTask(
          task.taskId,
          patch,
          this.session.user
        );
        const nextTask = projectService.toDraftTask(updated);
        const tasks = this.data.tasks.map((item) =>
          item.key === nextTask.key ? nextTask : item
        );
        this.commitTasks(tasks);
        wx.hideLoading();
        feedback.success(
          updated.assigneeId ? '任务已更新，工作者会收到通知' : '任务已更新'
        );
      } else {
        const nextTask = Object.assign({}, task, {
          title,
          description,
          quantity: patch.quantity,
          unitPrice: patch.unitPrice,
          total: Math.round(patch.quantity * patch.unitPrice),
          enabled: task.enabled !== false,
        });
        const tasks = this.data.tasks.map((item) =>
          item.key === nextTask.key ? nextTask : item
        );
        this.commitTasks(tasks);
        wx.hideLoading();
      }
      this.setData({ showEditor: false, editingTask: null, editingKey: '' });
    } catch (error) {
      wx.hideLoading();
      feedback.error(error.message || '任务保存失败');
    }
  },

  handleEditorClose() {
    this.setData({ showEditor: false, editingTask: null, editingKey: '' });
  },

  handlePublish() {
    if (this.data.isEdit || this.data.publishing) {
      return;
    }
    const name = String(this.data.name || '').trim();
    if (name.length < 2 || name.length > 30) {
      feedback.error('项目名称需要 2 到 30 个字符');
      return;
    }

    const tasks = this.data.tasks.map((task) => {
      const quantity =
        task.unitKey === 'once' ? 1 : Number(task.quantity) || 0;
      const unitPrice = Number(task.unitPrice) || 0;
      return Object.assign({}, task, {
        quantity,
        unitPrice,
        total: Math.round(quantity * unitPrice),
      });
    });
    const enabled = tasks.filter((task) => task.enabled !== false);
    if (!enabled.length) {
      feedback.error('请至少启用一项任务');
      return;
    }

    this.setData({ publishing: true });
    try {
      const result = projectService.publishProject(
        {
          name,
          code: this.data.code,
          description: this.data.description,
          deadline: this.data.deadline,
          tasks,
        },
        this.session.user
      );
      feedback.success('项目已发布');
      wx.redirectTo({ url: `/pages/project/index?id=${result.project.id}` });
    } catch (error) {
      this.setData({ publishing: false });
      feedback.error(error.message || '项目发布失败');
    }
  },

  async handleClearArchivedProject() {
    if (!this.data.isArchived) {
      return;
    }
    const result = await feedback.confirm({
      title: '彻底清除此项目？',
      content: `将永久删除「${this.data.name}」及其 ${this.data.tasks.length} 项任务、工作日志和排行结算记录。此操作不可撤销。`,
      confirmText: '彻底清除',
      cancelText: '保留归档',
      confirmColor: '#A6402F',
    });
    if (!result.confirm) {
      return;
    }
    wx.showLoading({ title: '清除中', mask: true });
    try {
      const outcome = projectService.clearArchivedProject(
        this.data.projectId,
        this.session.user
      );
      wx.hideLoading();
      feedback.success(`已清除，${outcome.taskCount} 项任务`);
      feedback.navigateBack('/pages/projects/index');
    } catch (error) {
      wx.hideLoading();
      feedback.error(error.message || '归档项目清除失败');
    }
  },

  async handleArchiveProject() {
    if (!this.data.isEdit || this.data.isArchived) {
      return;
    }    const result = await feedback.confirm({
      title: '归档整个项目？',
      content: `归档后「${this.data.name}」转为只读，未完成任务会取消并通知工作者，项目、任务与工作日志全部保留。`,
      confirmText: '归档项目',
      cancelText: '保留项目',
      confirmColor: '#A17826',
    });
    if (!result.confirm) {
      return;
    }
    wx.showLoading({ title: '归档中', mask: true });
    try {
      const outcome = projectService.archiveProject(
        this.data.projectId,
        this.session.user
      );
      wx.hideLoading();
      feedback.success(
        outcome.cancelledCount
          ? `项目已归档，${outcome.cancelledCount} 项任务已取消`
          : '项目已归档'
      );
      wx.redirectTo({ url: '/pages/projects/index' });
    } catch (error) {
      wx.hideLoading();
      feedback.error(error.message || '项目归档失败');
    }
  },

  handleCancel() {
    feedback.navigateBack('/pages/projects/index');
  },
});
