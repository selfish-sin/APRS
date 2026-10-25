const constants = require('../../utils/constants');
const sessionService = require('../../services/session');
const taskService = require('../../services/task-service');
const notices = require('../../services/notices');
const { getLayout } = require('../../utils/layout');
const dateUtil = require('../../utils/date');
const feedback = require('../../utils/feedback');

Page({
  data: {
    layout: {
      statusBarHeight: 20,
      navBarHeight: 44,
      topInset: 64,
    },
    user: {
      name: '',
      avatarColor: '#8a5a2b',
    },
    userInitial: '',
    role: constants.ROLES.EMPLOYEE,
    roleLabel: '工作者',
    isAdmin: false,
    greeting: '你好',
    dateLine: '',
    workspace: constants.WORKSPACE,
    stats: {
      total: 0,
      open: 0,
      in_progress: 0,
      in_review: 0,
      done: 0,
      mineActive: 0,
      mineReview: 0,
      mineDone: 0,
      progress: 0,
    },
    hero: {
      number: 0,
      lead: '份委托',
      body: '',
      ctaLabel: '查看委托',
      ctaAction: 'all',
    },
    filters: [],
    activeFilter: '',
    stages: [],
    processes: [],
    activeStage: 'all',
    activeProcess: '',
    stageTotal: 0,
    stageAllTotal: 0,
    noticeCount: 0,
    latestNotice: null,
    noticeList: [],
    keyword: '',
    tasks: [],
    loading: true,
    scrolled: false,
    emptyTitle: '暂无委托',
    emptyDesc: '',
    emptyActionLabel: '',
    emptyAction: '',
  },

  onLoad() {
    this.setData({ layout: getLayout() });
  },

  onResize() {
    this.setData({ layout: getLayout() });
  },

  onShow() {
    const session = sessionService.getSession();
    if (!session) {
      wx.reLaunch({ url: '/pages/login/index' });
      return;
    }
    this.session = session;
    const isAdmin = session.role === constants.ROLES.ADMIN;
    const initialized = this.initialized;
    const activeFilter =
      initialized && this.data.activeFilter
        ? this.data.activeFilter
        : isAdmin
          ? 'all'
          : 'open';
    const activeStage = initialized ? this.data.activeStage : 'all';
    const activeProcess = initialized ? this.data.activeProcess : '';

    this.setData({
      user: session.user,
      userInitial: constants.avatarText(session.user.name),
      role: session.role,
      roleLabel: constants.getRoleMeta(session.role).label,
      isAdmin,
      greeting: dateUtil.greeting(),
      dateLine: dateUtil.formatDateLong(new Date()),
      workspace: constants.WORKSPACE,
      activeFilter,
      activeStage,
      activeProcess,
    });
    this.initialized = true;
    this.loadBoard(!initialized);
    if (isAdmin) {
      this.setData({ noticeCount: 0, latestNotice: null, noticeList: [] });
    } else {
      this.loadNotices();
    }
  },

  loadNotices() {
    if (!this.session || this.session.role === constants.ROLES.ADMIN) {
      return;
    }
    const list = notices
      .listFor(this.session.user.id)
      .filter((notice) => !notice.read);
    this.setData({
      noticeList: list,
      noticeCount: list.length,
      latestNotice: list[0] || null,
    });
  },

  onHide() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  },

  onUnload() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  },

  onPageScroll(event) {
    const scrolled = event.scrollTop > 12;
    if (scrolled !== this.data.scrolled) {
      this.setData({ scrolled });
    }
  },

  onPullDownRefresh() {
    this.loadNotices();
    this.loadBoard(false).then(() => {
      wx.stopPullDownRefresh();
    });
  },

  onShareAppMessage() {
    return {
      title: 'APRS 动画部 · 告示栏上有一份新委托',
      path: '/pages/board/index',
    };
  },

  async loadBoard(showSkeleton) {
    if (!this.session) {
      return;
    }
    if (showSkeleton) {
      this.setData({ loading: true });
    }
    try {
      const result = await taskService.getBoard(this.session.user, {
        filter: this.data.activeFilter,
        stage: this.data.activeStage,
        process: this.data.activeProcess,
        keyword: this.data.keyword,
      });
      const empty = this.buildEmptyState(result);
      this.setData(
        Object.assign({}, result, {
          loading: false,
          emptyTitle: empty.title,
          emptyDesc: empty.desc,
          emptyActionLabel: empty.actionLabel,
          emptyAction: empty.action,
        })
      );
    } catch (error) {
      this.setData({ loading: false });
      feedback.error(error.message || '委托加载失败');
    }
  },

  buildEmptyState(result) {
    if (result.tasks.length > 0) {
      return { title: '', desc: '', actionLabel: '', action: '' };
    }
    if (result.keyword) {
      return {
        title: '没有找到相关委托',
        desc: '试试委托标题、卷宗场次或工作者名字。',
        actionLabel: '清除搜索',
        action: 'search',
      };
    }
    if (this.data.isAdmin) {
      return {
        title: '这面告示栏还没有委托',
        desc: '张贴一张新的委托卷轴，让动画部重新忙碌起来。',
        actionLabel: '张贴委托',
        action: 'create',
      };
    }

    if (result.activeProcess) {
      return {
        title: '这个工序暂时没有委托',
        desc: '换一个工序，或回到这个阶段的全部工序看看。',
        actionLabel: '查看全部工序',
        action: 'resetProcess',
      };
    }
    if (result.activeStage && result.activeStage !== 'all') {
      return {
        title: '这个阶段暂时没有委托',
        desc: '前期、中期、后期可以分别查看，也可以回到全部阶段。',
        actionLabel: '查看全部阶段',
        action: 'resetStage',
      };
    }

    const filter = result.activeFilter;
    if (filter === 'mine') {
      return {
        title: '你目前没有进行中的委托',
        desc: '去可接取的委托里挑一份合适的卷轴吧。',
        actionLabel: '去可接取',
        action: 'open',
      };
    }
    if (filter === 'in_review') {
      return {
        title: '没有待验收的交付',
        desc: '完成委托并提交验收后，结果会出现在这里。',
        actionLabel: '去可接取',
        action: 'open',
      };
    }
    if (filter === 'done') {
      return {
        title: '还没有归档记录',
        desc: '通过验收的委托会自动进入工作资料库。',
        actionLabel: '去可接取',
        action: 'open',
      };
    }
    if (filter === 'all') {
      return {
        title: '告示栏里还没有委托',
        desc: '等待部门管理员张贴第一张委托卷轴。',
        actionLabel: '',
        action: '',
      };
    }
    return {
      title: '暂时没有可接取的委托',
      desc: '新的卷轴很快会挂上告示栏，也可以看看全部委托。',
      actionLabel: '查看全部委托',
      action: 'all',
    };
  },

  handleFilterTap(event) {
    const filter = event.currentTarget.dataset.key;
    if (!filter || filter === this.data.activeFilter) {
      return;
    }
    feedback.vibrate();
    this.setData({ activeFilter: filter, activeProcess: '' });
    this.loadBoard(false);
  },

  handleStageTap(event) {
    const stage = event.currentTarget.dataset.key;
    if (!stage || stage === this.data.activeStage) {
      return;
    }
    feedback.vibrate();
    this.setData({ activeStage: stage, activeProcess: '' });
    this.loadBoard(false);
  },

  handleProcessTap(event) {
    const process = event.currentTarget.dataset.key || '';
    if (process === this.data.activeProcess) {
      return;
    }
    feedback.vibrate();
    this.setData({ activeProcess: process });
    this.loadBoard(false);
  },

  handleKeywordInput(event) {
    const keyword = event.detail.value;
    this.setData({ keyword });
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.loadBoard(false);
    }, 180);
  },

  handleClearSearch() {
    if (!this.data.keyword) {
      return;
    }
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.setData({ keyword: '' });
    this.loadBoard(false);
  },

  async handleHeroAction() {
    const action = this.data.hero.ctaAction;
    if (action === 'create') {
      this.goCreate();
      return;
    }
    if (!action) {
      return;
    }
    this.setData({
      activeFilter: action,
      activeStage: 'all',
      activeProcess: '',
      keyword: '',
    });
    await this.loadBoard(false);
    try {
      wx.pageScrollTo({ selector: '.task-section', duration: 300 });
    } catch (error) {
      // Scrolling to the list is a progressive enhancement.
    }
  },

  handleNoticeTap() {
    if (!this.session || !this.data.noticeList.length) {
      return;
    }
    const list = this.data.noticeList;
    const latest = list[0];
    const content = list
      .slice(0, 5)
      .map((notice) => `· ${notice.taskTitle}：${notice.message}`)
      .join('\n');
    notices.markAllRead(this.session.user.id);
    this.setData({ noticeList: [], noticeCount: 0, latestNotice: null });
    wx.showModal({
      title: `任务变更通知（${list.length}）`,
      content,
      confirmText: '查看最新',
      cancelText: '知道了',
      confirmColor: '#A17826',
      success(result) {
        if (result.confirm && latest && latest.taskId) {
          wx.navigateTo({ url: `/pages/detail/index?id=${latest.taskId}` });
        }
      },
    });
  },

  handleTaskOpen(event) {
    const id = event.detail.id;
    if (id) {
      wx.navigateTo({ url: `/pages/detail/index?id=${id}` });
    }
  },

  async handleTaskAction(event) {
    const detail = event.detail || {};
    const id = detail.id;
    const action = detail.action;
    if (!id) {
      return;
    }
    if (action === 'detail' || action === 'review') {
      wx.navigateTo({ url: `/pages/detail/index?id=${id}` });
      return;
    }

    const task = this.data.tasks.find((item) => item.id === id);
    if (!task) {
      return;
    }

    if (action === 'claim') {
      const result = await feedback.confirm({
        title: '接取这份委托？',
        content: `${task.title}\n接取后会记入你的「我的委托」，可以随时提交验收。`,
        confirmText: '接取委托',
      });
      if (!result.confirm) {
        return;
      }
      await this.runAction(
        () => taskService.claimTask(id, this.session.user),
        '委托已接取'
      );
      return;
    }

    if (action === 'submit') {
      const result = await feedback.confirm({
        title: '提交验收？',
        content: '提交后部门管理员会打开你的交付，制作进度将暂停等待验收。',
        confirmText: '提交验收',
      });
      if (!result.confirm) {
        return;
      }
      await this.runAction(
        () => taskService.submitTask(id, this.session.user),
        '已提交验收'
      );
    }
  },

  async runAction(action, successMessage) {
    wx.showLoading({ title: '处理中', mask: true });
    try {
      await action();
      wx.hideLoading();
      feedback.vibrate();
      feedback.success(successMessage);
      await this.loadBoard(false);
    } catch (error) {
      wx.hideLoading();
      feedback.error(error.message || '操作失败，请稍后重试');
    }
  },

  handleEmptyAction() {
    if (this.data.emptyAction === 'search') {
      this.setData({ keyword: '' });
      this.loadBoard(false);
      return;
    }
    if (this.data.emptyAction === 'create') {
      this.goCreate();
      return;
    }
    if (this.data.emptyAction === 'resetProcess') {
      this.setData({ activeProcess: '' });
      this.loadBoard(false);
      return;
    }
    if (this.data.emptyAction === 'resetStage') {
      this.setData({ activeStage: 'all', activeProcess: '' });
      this.loadBoard(false);
      return;
    }
    if (this.data.emptyAction === 'all') {
      this.setData({
        activeFilter: 'all',
        activeStage: 'all',
        activeProcess: '',
      });
      this.loadBoard(false);
      return;
    }
    if (this.data.emptyAction === 'open') {
      this.setData({
        activeFilter: 'open',
        activeStage: 'all',
        activeProcess: '',
        keyword: '',
      });
      this.loadBoard(false);
    }
  },

  openPage(url) {
    if (this.navLock) {
      return;
    }
    this.navLock = true;
    wx.navigateTo({
      url,
      fail: () => {
        feedback.error('页面打开失败，请重试');
      },
      complete: () => {
        setTimeout(() => {
          this.navLock = false;
        }, 500);
      },
    });
  },

  goProjects() {
    this.openPage('/pages/projects/index');
  },

  goCreate() {
    this.openPage('/pages/create/index');
  },

  goProfile() {
    wx.switchTab({ url: '/pages/profile/index' });
  },
});
