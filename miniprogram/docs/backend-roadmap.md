# 从本地试炼到真实双端协作

当前版本刻意把数据层收在 `services/` 下，页面只依赖 `task-service.js` 暴露的异步方法。这样可以在不改动页面结构的情况下替换数据来源。

## 推荐路径：微信云开发

适合先跑通多人协作的最小后端。

### 1. 集合设计

#### `users`

```json
{
  "_id": "account_123456789_employee",
  "qq": "123456789",
  "nickname": "陈默",
  "name": "陈默",
  "title": "原画师",
  "role": "employee",
  "avatarColor": "#35675D",
  "status": "active",
  "active": true,
  "createdAt": 1760000000000
}
```

`role` 仅允许 `admin` / `employee`，且 `(qq, role)` 必须建立唯一索引，保证同一 QQ 只能登记一次管理员、一次工作者。管理员注册时，`APRS1023` 秘钥只能在服务端校验，不能下发给客户端；资料接口也要按查看者角色决定是否返回 `qq`。`active` 表示执行权，取消后必须拒绝登录、接取与提交，并在同一事务里释放该成员进行中 / 待验收的任务。

#### `tasks`

```json
{
  "_id": "AF-1034",
  "title": "雨巷追光 · 清线整理",
  "description": "……",
  "stage": "mid",
  "category": "cleanup",
  "projectId": "proj_xxx",
  "projectName": "《山海邮局》第 1 集",
  "workload": {
    "quantity": 30,
    "unitKey": "sheet",
    "unitLabel": "张",
    "unitPrice": 20,
    "total": 600
  },
  "priority": "normal",
  "status": "open",
  "batch": "EP01 · SC15",
  "dueDate": "2026-10-25",
  "reward": 600,
  "assigneeId": "",
  "assigneeName": "",
  "creatorId": "admin_lin",
  "creatorName": "林知夏",
  "reviewNote": "",
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000,
  "completedAt": 0
}
```

`category` 保存具体工序 key，`stage` 为 `pre / mid / post`，由工序推导。阶段与工序的完整枚举集中在 `utils/constants.js` 的 `STAGES` 与 `PROCESSES`，服务端应复用同一份枚举做校验与筛选。

项目归档时，未完成任务需要先保存 `archivedFromStatus`（`open / in_progress / in_review`），再标记为 `cancelled`；归档库据此区分「招揽中 / 进行中 / 待验收」。

为了并发安全，任务动态建议放到 `task_logs` 集合或 `tasks/{id}/logs` 子集合，写入时使用服务端时间。

#### `task_logs`

```json
{
  "_id": "auto",
  "taskId": "AF-1030",
  "type": "claim",
  "actorId": "openid",
  "actorName": "陈默",
  "text": "接取了委托，开始制作",
  "at": 1760000000000
}
```

#### `projects`

```json
{
  "_id": "proj_xxx",
  "name": "《山海邮局》第 1 集",
  "code": "EP01",
  "description": "……",
  "status": "published",
  "deadline": "2026-11-22",
  "taskIds": ["AF-1034", "AF-1035"],
  "taskCount": 23,
  "totalAmount": 5840,
  "createdBy": "account_xxx_admin",
  "publishedAt": 1760000000000
}
```

立项生成任务与项目记录应放在同一个数据库事务里；任务量、单价和总额由服务端重新计算，不能接受客户端直接传入的 `reward`。

#### `notices`

```json
{
  "_id": "auto",
  "accountId": "account_xxx_employee",
  "taskId": "AF-1034",
  "taskTitle": "原画 · 修订版",
  "projectName": "《山海邮局》第 1 集",
  "message": "任务已更新：工作量 10 张 → 12 张",
  "read": false,
  "createdAt": 1760000000000
}
```

修改已发布任务时，由服务端写入通知；跨设备场景建议再调用微信订阅消息。

### 2. 云函数 / 服务端接口

| 方法 | 作用 | 服务端校验 |
| --- | --- | --- |
| `login` | 返回当前账号资料与角色 | 校验 QQ + 角色唯一性；管理员注册校验秘钥；不信任前端角色 |
| `getBoard` | 看板数据、统计、筛选项 | 只返回该角色可见范围 |
| `getTask` | 委托详情和动态 | — |
| `createTask` | 张贴委托，公开或指派 | 仅 admin；校验交付期限、工作者 |
| `publishProject` | 立项并批量生成任务 | 仅 admin；事务内创建项目与任务；重算工作量 × 单价 |
| `updateProjectTask` | 修改已发布任务 | 仅 admin；重新计算赏金并写入通知 |
| `setExecutionRight` | 取消 / 恢复成员执行权 | 仅 admin；停用时拒绝该账号登录并释放其进行中任务 |
| `deleteMember` | 删除成员资料 | 仅 admin；事务内释放任务、清理通知并删除账号 |
| `cancelTask` | 取消单个任务 | 仅 admin；任务标记 `cancelled`，通知接取人并重算项目总额 |
| `archiveProject` | 归档项目 | 仅 admin；项目转只读，未完成任务记录 `archivedFromStatus` 后标记 `cancelled` 并通知接取人，保留全部记录 |
| `listArchivedProjects` | 归档项目列表 | 仅 admin；按项目汇总归档前招揽 / 进行中 / 待验收 / 已完成数量 |
| `clearArchivedProject` | 彻底清除单个归档 | 仅 admin；事务内删除该项目及其任务、通知与排行记录 |
| `clearArchivedProjects` | 彻底清除归档 | 仅 admin；事务内删除全部归档项目及其任务、通知与排行记录，不影响进行中项目 |
| `claimTask` | 接取公开委托 | 仅 employee；事务内校验 `status === open` 且无接取人 |
| `submitTask` | 提交验收 | 仅接取人本人；`in_progress → in_review` |
| `reviewTask` | 通过或退回 | 仅 admin；退回意见必填 |
| `getProfile` | 个人统计、团队负载、积分 | 按当前用户聚合 |
| `getMonthlyRanking` | 月度结算排行 | 按 `completedAt` 月份聚合 `done` 任务，统计赏金、任务量与工作量单位；建议建立 `(completedAt, assigneeId)` 索引 |

### 3. 并发接取的原子写法

本地版本靠单线程顺序执行即可，真实服务端必须避免两个工作者同时接取同一份委托。以云开发数据库事务为例：

```js
const transaction = await db.startTransaction();
const ref = transaction.collection('tasks').doc(taskId);
const snapshot = await ref.get();
const task = snapshot.data;
if (task.status !== 'open' || task.assigneeId) {
  await transaction.rollback();
  throw new Error('委托已被接取');
}
await ref.update({
  data: {
    status: 'in_progress',
    assigneeId: openid,
    assigneeName: currentUser.name,
    updatedAt: db.serverDate(),
  },
});
await transaction.collection('task_logs').add({
  data: {
    taskId,
    type: 'claim',
    actorId: openid,
    actorName: currentUser.name,
    text: '接取了委托，开始制作',
    at: db.serverDate(),
  },
});
await transaction.commit();
```

若不用事务，也可使用带条件更新（`where({ _id: taskId, status: 'open' })`）并检查 `stats.updated`，同样能避免超领。

## 迁移步骤（最小改动）

1. 新建 `services/cloud-store.js`，实现与当前 `store.loadTasks / saveTasks / getTask / resetDemoData` 等价的方法。
2. 或者直接把 `task-service.js` 中同步的 `store` 调用改为 `await api.*` 调用。
3. 保留现有的视图模型字段（`actionLabel`、`dueLabel`、`logs` 等），页面层无需改动。
4. 在 `app.js` 中初始化 `wx.cloud`，并把 `project.config.json` 的 AppID 换成真实 AppID。
5. 将本地 QQ 账号资料替换为服务端账号体系，管理员秘钥与管理员身份由服务端校验。

建议保持 `task-service.js` 的**方法名和返回结构**不变：

```js
getBoard(actor, { filter, keyword })
getTask(taskId, actor)
createTask(input, actor)
claimTask(taskId, actor)
submitTask(taskId, actor)
reviewTask(taskId, actor, decision, note)
getProfile(actor)
resetDemoData()
```

## 实时同步

可选方案：

- 云开发 `db.collection('tasks').watch()`：看板与详情页订阅变更，实现真正的双端实时刷新；
- 轮询：页面 `onShow` + 每 15～30 秒刷新，成本最低；
- 云函数触发订阅消息：委托被接取、提交、退回时推送微信订阅消息。

## 权限与安全

- 所有写操作必须在云函数或数据库规则中重新校验角色，不能依赖前端隐藏按钮。
- 工作者只能提交和查看自己委托的写权限；部门管理员才可验收和指派。
- 验收意见、委托说明都属于用户输入，渲染时需要保持纯文本，避免注入 HTML。
- 附件应存储到云存储，只在委托表中保存文件 ID 与展示名。
- 记录服务端时间与操作人 openid，不信任客户端时间戳。

## 后续产品功能

- 委托附件与审片链接
- 消息提醒与逾期提醒
- 委托转派、批量张贴
- 项目 / 集数 / 镜头层级
- 产能与工时统计
- 成员邀请与角色管理
- 验收历史与版本对比
- 离线队列与网络恢复同步
