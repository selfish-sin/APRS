const ROLES = {
  ADMIN: 'admin',
  EMPLOYEE: 'employee',
};

// Client-side demo gate only. A real backend must validate this secret server-side.
const ADMIN_SECRET = 'APRS1023';

const ROLE_META = {
  admin: {
    key: ROLES.ADMIN,
    label: '部门管理员',
    shortLabel: '部门端',
    description: '张贴委托、指派工作者、验收交付',
  },
  employee: {
    key: ROLES.EMPLOYEE,
    label: '工作者',
    shortLabel: '工作者端',
    description: '接取委托、推进制作、提交验收',
  },
};

const WORKSPACE = {
  studio: 'APRS 动画部',
  subtitle: '动画制作协作台',
};

const STAGES = [
  {
    key: 'pre',
    name: '前期',
    en: 'PRE',
    shortName: '前',
    order: 1,
    color: '#a6402f',
    soft: '#f3ddd2',
  },
  {
    key: 'mid',
    name: '中期',
    en: 'MID',
    shortName: '中',
    order: 2,
    color: '#35675d',
    soft: '#dfeae2',
  },
  {
    key: 'post',
    name: '后期',
    en: 'POST',
    shortName: '后',
    order: 3,
    color: '#6a537f',
    soft: '#e9e1f0',
  },
];

const STAGE_MAP = {};
STAGES.forEach((stage) => {
  STAGE_MAP[stage.key] = stage;
});

const WORKLOAD_UNITS = {
  once: {
    key: 'once',
    label: '项',
    name: '一次性',
    hint: '一次性工作，直接结算',
  },
  sheet: {
    key: 'sheet',
    label: '张',
    name: '绘画张数',
    hint: '按绘画张数计算',
  },
  second: {
    key: 'second',
    label: '秒',
    name: '时长',
    hint: '按秒数时长计算',
  },
  scene: {
    key: 'scene',
    label: '个场景',
    name: '场景个数',
    hint: '按场景个数计算',
  },
  char: {
    key: 'char',
    label: '字',
    name: '字数',
    hint: '按配音字数计算',
  },
  asset: {
    key: 'asset',
    label: '条',
    name: '音效素材',
    hint: '按音效素材数量计算',
  },
};

const PROCESS_DEFINITIONS = [
  { key: 'planning', stage: 'pre', name: '策划', en: 'PLANNING', shortName: '策', unitKey: 'once' },
  { key: 'script', stage: 'pre', name: '剧本', en: 'SCRIPT', shortName: '本', unitKey: 'once' },
  { key: 'storyboard', stage: 'pre', name: '分镜', en: 'STORYBOARD', shortName: '分', unitKey: 'sheet' },
  { key: 'art_design', stage: 'pre', name: '美术设计', en: 'ART DESIGN', shortName: '美', unitKey: 'once' },
  { key: 'layout', stage: 'pre', name: 'Layout', en: 'LAYOUT', shortName: '构', unitKey: 'sheet' },

  { key: 'keyframe', stage: 'mid', name: '原画', en: 'KEY ANIMATION', shortName: '原', unitKey: 'sheet' },
  {
    key: 'keyframe_direction',
    stage: 'mid',
    name: '原画监督',
    en: 'ANIMATION DIRECTION',
    shortName: '监',
    unitKey: 'sheet',
  },
  { key: 'cleanup', stage: 'mid', name: '清线', en: 'CLEAN UP', shortName: '清', unitKey: 'sheet' },
  { key: 'inbetween', stage: 'mid', name: '中割', en: 'INBETWEEN', shortName: '割', unitKey: 'sheet' },
  {
    key: 'inbetween_check',
    stage: 'mid',
    name: '中割检修',
    en: 'INBETWEEN CHECK',
    shortName: '检',
    unitKey: 'sheet',
  },

  {
    key: 'paint_output',
    stage: 'post',
    name: '上色文件输出',
    en: 'PAINT FILE OUTPUT',
    shortName: '输',
    unitKey: 'sheet',
  },
  {
    key: 'color_check',
    stage: 'post',
    name: '色指定检查',
    en: 'COLOR CHECK',
    shortName: '查',
    unitKey: 'sheet',
  },
  {
    key: 'color_apply',
    stage: 'post',
    name: '色指定执行',
    en: 'COLOR APPLY',
    shortName: '定',
    unitKey: 'sheet',
  },
  { key: 'paint', stage: 'post', name: '上色', en: 'PAINT', shortName: '上', unitKey: 'sheet' },
  {
    key: 'layer_paint',
    stage: 'post',
    name: '上色层导出',
    en: 'PAINT LAYER EXPORT',
    shortName: '层',
    unitKey: 'sheet',
  },
  {
    key: 'layer_line',
    stage: 'post',
    name: '线稿层导出',
    en: 'LINE LAYER EXPORT',
    shortName: '线',
    unitKey: 'sheet',
  },
  {
    key: 'layer_special',
    stage: 'post',
    name: '特殊层导出',
    en: 'SPECIAL LAYER EXPORT',
    shortName: '特',
    unitKey: 'sheet',
  },
  {
    key: 'scene_paint',
    stage: 'post',
    name: '场景绘制',
    en: 'SCENE PAINT',
    shortName: '景',
    unitKey: 'scene',
  },
  {
    key: 'composite',
    stage: 'post',
    name: '影像合成',
    en: 'COMPOSITE',
    shortName: '合',
    unitKey: 'second',
  },
  { key: 'vfx', stage: 'post', name: '特效', en: 'VFX', shortName: '效', unitKey: 'second' },
  { key: 'voice', stage: 'post', name: '配音', en: 'VOICE', shortName: '声', unitKey: 'char' },
  { key: 'sound', stage: 'post', name: '音效合成', en: 'SOUND MIX', shortName: '音', unitKey: 'asset' },
  {
    key: 'final_output',
    stage: 'post',
    name: '成片输出',
    en: 'FINAL OUTPUT',
    shortName: '片',
    unitKey: 'second',
  },
];

const PROCESSES = PROCESS_DEFINITIONS.map((process, index) => {
  const stage = STAGE_MAP[process.stage];
  const unit = WORKLOAD_UNITS[process.unitKey];
  return Object.assign({}, process, {
    color: stage.color,
    soft: stage.soft,
    stageName: stage.name,
    order: index + 1,
    unitLabel: unit.label,
    unitName: unit.name,
  });
});

const CATEGORIES = PROCESSES;

const LEGACY_CATEGORY_MAP = {
  keyframe: 'keyframe',
  animation: 'inbetween',
  color: 'paint',
  background: 'scene_paint',
  composite: 'composite',
};

const PRIORITIES = [
  {
    key: 'low',
    name: '寻常',
    rank: 'I',
    stars: '★☆☆☆',
    color: '#7c715f',
    soft: '#ece7db',
  },
  {
    key: 'normal',
    name: '进阶',
    rank: 'II',
    stars: '★★☆☆',
    color: '#5f6a55',
    soft: '#e6e9df',
  },
  {
    key: 'high',
    name: '棘手',
    rank: 'III',
    stars: '★★★☆',
    color: '#a17826',
    soft: '#f2e6c8',
  },
  {
    key: 'urgent',
    name: '危急',
    rank: 'IV',
    stars: '★★★★',
    color: '#a6402f',
    soft: '#f3ddd2',
  },
];

const STATUSES = [
  { key: 'open', name: '待接取', color: '#a17826', soft: '#f4e8c9' },
  { key: 'in_progress', name: '进行中', color: '#35675d', soft: '#e0ebe4' },
  { key: 'in_review', name: '待验收', color: '#6a537f', soft: '#e9e1f0' },
  { key: 'done', name: '已归档', color: '#4d6b45', soft: '#e4ebdd' },
  { key: 'cancelled', name: '已取消', color: '#8a7350', soft: '#ece7db' },
];

function findByKey(list, key) {
  for (let index = 0; index < list.length; index += 1) {
    if (list[index].key === key) {
      return list[index];
    }
  }
  return list[0];
}

function findProcess(key) {
  for (let index = 0; index < PROCESSES.length; index += 1) {
    if (PROCESSES[index].key === key) {
      return PROCESSES[index];
    }
  }
  const legacyKey = LEGACY_CATEGORY_MAP[key];
  if (legacyKey) {
    for (let index = 0; index < PROCESSES.length; index += 1) {
      if (PROCESSES[index].key === legacyKey) {
        return PROCESSES[index];
      }
    }
  }
  return null;
}

function getCategory(key) {
  return findProcess(key) || PROCESSES[0];
}

function getStage(key) {
  return STAGE_MAP[key] || STAGES[0];
}

function getStageOfCategory(key) {
  const process = getCategory(key);
  return STAGE_MAP[process.stage] || STAGES[0];
}

function getProcessesForStage(stageKey) {
  return PROCESSES.filter((process) => process.stage === stageKey);
}

function getWorkloadUnit(key) {
  return WORKLOAD_UNITS[key] || WORKLOAD_UNITS.once;
}

function getStages() {
  return STAGES.slice();
}

function getPriority(key) {
  return findByKey(PRIORITIES, key);
}

function getStatus(key) {
  return findByKey(STATUSES, key);
}

function getRoleMeta(role) {
  return ROLE_META[role] || ROLE_META.employee;
}

function avatarText(name) {
  if (!name) {
    return '·';
  }
  return name.slice(0, 1);
}

module.exports = {
  ROLES,
  ADMIN_SECRET,
  ROLE_META,
  WORKSPACE,
  STAGES,
  PROCESSES,
  WORKLOAD_UNITS,
  CATEGORIES,
  PRIORITIES,
  STATUSES,
  findProcess,
  getCategory,
  getStage,
  getStageOfCategory,
  getProcessesForStage,
  getWorkloadUnit,
  getStages,
  getPriority,
  getStatus,
  getRoleMeta,
  avatarText,
};
