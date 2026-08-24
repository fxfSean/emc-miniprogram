const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const ok = data => ({ ok: true, data })
const fail = message => ({ ok: false, message })

const TYPES = ['REVIEW_RESULT', 'RESERVATION_CREATED', 'RESERVATION_CANCELLED', 'RESERVATION_REMINDER', 'DEVICE_MAINTENANCE']
const TEMPLATE_KEYS = ['review', 'reservationCreated', 'reservationCancelled', 'reminder', 'maintenance', 'announcement']
const TEMPLATE_SEMANTICS = {
  review: ['result', 'time', 'note'],
  reservationCreated: ['device', 'time', 'note'],
  reservationCancelled: ['device', 'time', 'reason'],
  reminder: ['device', 'time', 'note'],
  maintenance: ['device', 'time', 'reason'],
  announcement: ['title', 'time', 'content']
}
const DEFAULT_SETTINGS = {
  reminderMinutes: 30,
  announcementWechatEnabled: false,
  templates: Object.fromEntries(TEMPLATE_KEYS.map(key => [key, { templateId: '', fields: {} }]))
}

function toMs(value) {
  if (value instanceof Date) return value.getTime()
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}
function formatDateTime(value) {
  const ms = toMs(value)
  if (!ms) return ''
  const date = new Date(ms + 8 * 3600000)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')} ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}
function short(value, limit = 100) { return String(value || '').trim().slice(0, limit) }
function safeId(value) { return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 240) }
function normalizeTemplate(value, key) {
  const source = value || {}, fields = source.fields || {}, allowed = TEMPLATE_SEMANTICS[key]
  const normalizedFields = {}
  allowed.forEach(semantic => {
    const field = short(fields[semantic], 40)
    if (field) normalizedFields[semantic] = field
  })
  return { templateId: short(source.templateId, 100), fields: normalizedFields }
}
function normalizeSettings(value) {
  const source = value || {}, minutes = Number(source.reminderMinutes)
  const templates = {}
  TEMPLATE_KEYS.forEach(key => { templates[key] = normalizeTemplate((source.templates || {})[key], key) })
  return {
    reminderMinutes: [15, 30].includes(minutes) ? minutes : DEFAULT_SETTINGS.reminderMinutes,
    announcementWechatEnabled: source.announcementWechatEnabled === true,
    templates
  }
}
async function getSettings() {
  const result = await db.collection('settings').doc('notification').get().catch(() => ({ data: {} }))
  return normalizeSettings(result.data)
}
async function currentUser(openid) {
  if (!openid) return null
  return (await db.collection('users').where({ openid }).limit(1).get()).data[0] || null
}
function isAdmin(user) { return user && user.role === 'ADMIN' && user.status === 'APPROVED' }
function publicNotification(item, kind = 'MESSAGE') {
  return {
    _id: item._id,
    kind,
    type: TYPES.includes(item.type) ? item.type : (kind === 'ANNOUNCEMENT' ? 'ANNOUNCEMENT' : 'NOTICE'),
    title: short(item.title, 60),
    content: short(item.content, 500),
    businessType: short(item.businessType, 30),
    businessId: short(item.businessId, 100),
    navigation: item.navigation && typeof item.navigation === 'object' ? { page: short(item.navigation.page, 40), params: { id: short((item.navigation.params || {}).id, 100) } } : null,
    read: Boolean(item.readAt),
    createdAt: toMs(item.createdAt || item.publishedAt),
    createdAtText: formatDateTime(item.createdAt || item.publishedAt),
    startsAt: toMs(item.startsAt),
    endsAt: toMs(item.endsAt),
    validityText: kind === 'ANNOUNCEMENT' ? `${formatDateTime(item.startsAt)} 至 ${formatDateTime(item.endsAt)}` : ''
  }
}
async function activeAnnouncements(now = Date.now()) {
  return (await db.collection('announcements').where({ status: 'PUBLISHED', startsAt: _.lte(now), endsAt: _.gt(now) }).orderBy('publishedAt', 'desc').limit(100).get()).data
}
async function announcementReadMap(userId, announcements) {
  if (!announcements.length) return {}
  const ids = announcements.map(item => safeId(`${item._id}_${userId}`))
  const reads = (await db.collection('announcement_reads').where({ _id: _.in(ids) }).limit(100).get()).data
  return Object.fromEntries(reads.map(item => [item.announcementId, true]))
}
async function summary(user) {
  const [messages, announcements] = await Promise.all([
    db.collection('notifications').where({ recipientUserId: user._id, readAt: null }).count(),
    user.status === 'APPROVED' ? activeAnnouncements() : Promise.resolve([])
  ])
  const readMap = await announcementReadMap(user._id, announcements)
  const announcementUnread = announcements.filter(item => !readMap[item._id]).length
  const latest = (await db.collection('notifications').where({ recipientUserId: user._id }).orderBy('createdAt', 'desc').limit(1).get()).data[0]
  const settings = await getSettings()
  return {
    unreadCount: messages.total + announcementUnread,
    latestTitle: latest ? short(latest.title, 60) : (announcements[0] ? short(announcements[0].title, 60) : '暂无新消息'),
    wechatConfigured: TEMPLATE_KEYS.some(key => Boolean(settings.templates[key].templateId))
  }
}
async function listMessages(event, user) {
  const page = Math.max(1, Number(event.page) || 1), pageSize = Math.min(20, Math.max(1, Number(event.pageSize) || 20))
  const offset = (page - 1) * pageSize
  const result = await db.collection('notifications').where({ recipientUserId: user._id }).orderBy('createdAt', 'desc').skip(offset).limit(pageSize).get()
  let items = result.data.map(item => publicNotification(item))
  if (page === 1 && user.status === 'APPROVED') {
    const announcements = await activeAnnouncements()
    const readMap = await announcementReadMap(user._id, announcements)
    const announcementItems = announcements.map(item => publicNotification({ ...item, readAt: readMap[item._id] ? true : null }, 'ANNOUNCEMENT'))
    items = [...items, ...announcementItems].sort((a, b) => b.createdAt - a.createdAt)
  }
  return { items, page, pageSize, hasMore: result.data.length === pageSize }
}
async function markRead(event, user) {
  const id = short(event.id, 240), kind = event.kind === 'ANNOUNCEMENT' ? 'ANNOUNCEMENT' : 'MESSAGE'
  if (!id) return fail('消息参数无效')
  if (kind === 'ANNOUNCEMENT') {
    if (user.status !== 'APPROVED') return fail('当前账号不可查看公告')
    const announcement = (await db.collection('announcements').doc(id).get().catch(() => ({ data: null }))).data
    if (!announcement || announcement.status !== 'PUBLISHED') return fail('公告不存在或已停用')
    await db.collection('announcement_reads').doc(safeId(`${id}_${user._id}`)).set({ data: { announcementId: id, userId: user._id, readAt: db.serverDate() } })
  } else {
    const message = (await db.collection('notifications').doc(id).get().catch(() => ({ data: null }))).data
    if (!message || message.recipientUserId !== user._id) return fail('消息不存在')
    if (!message.readAt) await db.collection('notifications').doc(id).update({ data: { readAt: db.serverDate(), updatedAt: db.serverDate() } })
  }
  return ok(true)
}
async function markAllRead(user) {
  while (true) {
    const rows = (await db.collection('notifications').where({ recipientUserId: user._id, readAt: null }).limit(100).get()).data
    if (!rows.length) break
    await Promise.all(rows.map(item => db.collection('notifications').doc(item._id).update({ data: { readAt: db.serverDate(), updatedAt: db.serverDate() } })))
    if (rows.length < 100) break
  }
  const announcements = user.status === 'APPROVED' ? await activeAnnouncements() : []
  await Promise.all(announcements.map(item => db.collection('announcement_reads').doc(safeId(`${item._id}_${user._id}`)).set({ data: { announcementId: item._id, userId: user._id, readAt: db.serverDate() } })))
  return ok(true)
}
async function subscriptionTemplates() {
  const settings = await getSettings()
  const templates = TEMPLATE_KEYS.map(key => ({ key, templateId: settings.templates[key].templateId })).filter(item => item.templateId)
  return ok({ templates, configured: templates.length > 0 })
}
async function saveSubscriptionResult(event, user) {
  const settings = await getSettings(), allowedIds = new Set(TEMPLATE_KEYS.map(key => settings.templates[key].templateId).filter(Boolean))
  const source = event.results || {}, templateResults = {}
  Object.keys(source).slice(0, 10).forEach(id => {
    const value = source[id]
    if (allowedIds.has(id) && ['accept', 'reject', 'ban'].includes(value)) templateResults[id] = value
  })
  const existing = (await db.collection('notification_preferences').doc(user._id).get().catch(() => ({ data: null }))).data
  await db.collection('notification_preferences').doc(user._id).set({ data: { userId: user._id, templateResults: { ...((existing || {}).templateResults || {}), ...templateResults }, updatedAt: db.serverDate() } })
  return ok(true)
}
function validateFieldName(value) { return /^[a-z][a-z0-9_]*\d+$/i.test(value) }
function validateSettings(event) {
  const settings = normalizeSettings(event.settings || event)
  if (![15, 30].includes(Number(event.settings ? event.settings.reminderMinutes : event.reminderMinutes))) return { error: '预约提醒时间只能选择 15 或 30 分钟' }
  for (const key of TEMPLATE_KEYS) {
    const template = settings.templates[key]
    if (template.templateId) {
      const expected = TEMPLATE_SEMANTICS[key]
      if (expected.some(semantic => !template.fields[semantic])) return { error: `${key} 的字段映射不完整` }
      if (Object.values(template.fields).some(field => !validateFieldName(field))) return { error: `${key} 的模板字段名称无效` }
    }
  }
  return { settings }
}
async function adminListAnnouncements(event) {
  const status = ['ALL', 'PUBLISHED', 'DISABLED'].includes(event.status) ? event.status : 'ALL'
  const page = Math.max(1, Number(event.page) || 1), pageSize = 20, where = status === 'ALL' ? {} : { status }
  const query = status === 'ALL' ? db.collection('announcements') : db.collection('announcements').where(where)
  const [rowsResult, overviewResult] = await Promise.all([
    query.orderBy('publishedAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get(),
    db.collection('announcements').orderBy('publishedAt', 'desc').limit(100).get()
  ])
  const rows = rowsResult.data, overviewRows = overviewResult.data
  const now = Date.now(), items = rows.map(item => ({
    _id: item._id,
    title: short(item.title, 60), content: short(item.content, 2000), status: item.status,
    statusText: item.status === 'DISABLED' ? '已停用' : (item.endsAt <= now ? '已过期' : (item.startsAt > now ? '待生效' : '生效中')),
    startsAt: item.startsAt, endsAt: item.endsAt, startsAtText: formatDateTime(item.startsAt), endsAtText: formatDateTime(item.endsAt),
    pushWechat: item.pushWechat === true, publishedAtText: formatDateTime(item.publishedAt), canDisable: item.status === 'PUBLISHED'
  }))
  const counts = { ACTIVE: 0, DISABLED: 0, EXPIRED: 0 }
  overviewRows.forEach(item => {
    if (item.status === 'DISABLED') counts.DISABLED += 1
    else if (item.endsAt <= now) counts.EXPIRED += 1
    else counts.ACTIVE += 1
  })
  return ok({ items, counts, page, hasMore: rows.length === pageSize })
}
async function allApprovedUsers() {
  const rows = []
  for (let offset = 0; ; offset += 100) {
    const batch = (await db.collection('users').where({ status: 'APPROVED' }).skip(offset).limit(100).get()).data
    rows.push(...batch)
    if (batch.length < 100) break
  }
  return rows
}
async function queueAnnouncementDeliveries(announcement, settings) {
  if (!announcement.pushWechat || !settings.announcementWechatEnabled || !settings.templates.announcement.templateId) return
  const users = await allApprovedUsers()
  await Promise.all(users.filter(user => user.openid).map(user => {
    const id = safeId(`announcement_${announcement._id}_${user._id}`)
    return db.collection('notification_deliveries').doc(id).set({ data: {
      notificationId: announcement._id, recipientUserId: user._id,
      channel: 'WECHAT_SUBSCRIBE', templateKey: 'announcement', status: 'PENDING', attempts: 0,
      payload: { title: announcement.title, time: formatDateTime(announcement.publishedAt || Date.now()), content: announcement.content },
      page: 'pages/notifications/index', createdAt: db.serverDate(), updatedAt: db.serverDate()
    } })
  }))
}
async function adminPublishAnnouncement(event, adminUser) {
  const title = short(event.title, 60), content = short(event.content, 2000), startsAt = Number(event.startsAt), endsAt = Number(event.endsAt)
  if (!title || !content) return fail('请填写公告标题和正文')
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || startsAt >= endsAt || endsAt <= Date.now()) return fail('公告有效期无效')
  const settings = await getSettings(), pushWechat = event.pushWechat === true
  if (pushWechat && (!settings.announcementWechatEnabled || !settings.templates.announcement.templateId)) return fail('公告微信推送尚未配置')
  const result = await db.collection('announcements').add({ data: { title, content, status: 'PUBLISHED', startsAt, endsAt, pushWechat, publishedBy: adminUser._id, publishedAt: db.serverDate(), createdAt: db.serverDate(), updatedAt: db.serverDate() } })
  if (pushWechat) {
    const announcement = { _id: result._id, title, content, pushWechat, publishedAt: Date.now() }
    await queueAnnouncementDeliveries(announcement, settings).catch(error => console.error('queue announcement delivery failed', { announcementId: result._id, message: error.message }))
  }
  return ok({ id: result._id })
}
async function adminDisableAnnouncement(event, adminUser) {
  const id = short(event.id, 100)
  const announcement = (await db.collection('announcements').doc(id).get().catch(() => ({ data: null }))).data
  if (!announcement || announcement.status !== 'PUBLISHED') return fail('公告不存在或已停用')
  await db.collection('announcements').doc(id).update({ data: { status: 'DISABLED', disabledBy: adminUser._id, disabledAt: db.serverDate(), updatedAt: db.serverDate() } })
  return ok(true)
}
async function adminSaveSettings(event, adminUser) {
  const result = validateSettings(event)
  if (result.error) return fail(result.error)
  const data = { ...result.settings, updatedBy: adminUser._id, updatedAt: db.serverDate() }
  await db.collection('settings').doc('notification').set({ data })
  return ok(result.settings)
}
async function putReminder(row, deviceName, minutes) {
  const id = safeId(`reservation_reminder_${row._id}_${row.startAt}_${minutes}`)
  const content = `${deviceName}，${formatDateTime(row.startAt)}–${formatDateTime(row.endAt).slice(11)}`
  await db.collection('notifications').doc(id).set({ data: {
    recipientUserId: row.userId, type: 'RESERVATION_REMINDER', title: `预约将在 ${minutes} 分钟后开始`, content,
    businessType: 'RESERVATION', businessId: row._id, navigation: { page: 'MINE_RESERVATION', params: { id: row._id } },
    templateKey: 'reminder', templatePayload: { device: deviceName, time: `${formatDateTime(row.startAt)}–${formatDateTime(row.endAt).slice(11)}`, note: `请提前到达并按要求签到` },
    pushStatus: 'PENDING', readAt: null, createdAt: db.serverDate(), updatedAt: db.serverDate()
  } })
}
async function scanReminders() {
  const settings = await getSettings(), now = Date.now(), target = now + settings.reminderMinutes * 60000
  const start = target - 5 * 60000, end = target + 60000
  const rows = (await db.collection('reservations').where({ status: 'BOOKED', startAt: _.gte(start).and(_.lt(end)) }).orderBy('startAt', 'asc').limit(100).get()).data
  const deviceIds = [...new Set(rows.map(item => item.deviceId))]
  const devices = deviceIds.length ? (await db.collection('devices').where({ _id: _.in(deviceIds) }).field({ _id: true, name: true }).get()).data : []
  const names = Object.fromEntries(devices.map(item => [item._id, item.name]))
  await Promise.all(rows.map(row => putReminder(row, names[row.deviceId] || '预约设备', settings.reminderMinutes)))
  return rows.length
}
function templateData(template, payload) {
  const data = {}
  Object.entries(template.fields).forEach(([semantic, field]) => {
    const limit = field.startsWith('phrase') ? 5 : (field.startsWith('name') ? 10 : (field.startsWith('character_string') ? 32 : 20))
    data[field] = { value: short(payload[semantic] || '—', limit) }
  })
  return data
}
async function userPreference(userId) {
  return (await db.collection('notification_preferences').doc(userId).get().catch(() => ({ data: null }))).data
}
async function sendSubscription({ deliveryId, notification, delivery, settings, user }) {
  const templateKey = delivery ? delivery.templateKey : notification.templateKey
  const template = settings.templates[templateKey]
  const payload = delivery ? delivery.payload : notification.templatePayload
  const targetUser = user || (await db.collection('users').doc(delivery.recipientUserId).get().catch(() => ({ data: null }))).data
  const existingDelivery = delivery || (await db.collection('notification_deliveries').doc(deliveryId).get().catch(() => ({ data: null }))).data
  const attempts = Math.max(0, Number((existingDelivery || {}).attempts) || 0)
  const base = { notificationId: delivery ? delivery.notificationId : notification._id, recipientUserId: targetUser ? targetUser._id : '', channel: 'WECHAT_SUBSCRIBE', templateKey, attempts, updatedAt: db.serverDate() }
  if (!template || !template.templateId || !targetUser || !targetUser.openid) {
    await db.collection('notification_deliveries').doc(deliveryId).set({ data: { ...base, status: 'SKIPPED', resultCode: 'NOT_CONFIGURED', resultMessage: '模板或接收用户未配置', attemptedAt: db.serverDate(), createdAt: db.serverDate() } })
    return 'SKIPPED'
  }
  const preference = await userPreference(targetUser._id)
  if (preference && preference.templateResults && ['reject', 'ban'].includes(preference.templateResults[template.templateId])) {
    await db.collection('notification_deliveries').doc(deliveryId).set({ data: { ...base, status: 'SKIPPED', resultCode: 'NOT_AUTHORIZED', resultMessage: '用户未授权该模板', attemptedAt: db.serverDate(), createdAt: db.serverDate() } })
    return 'SKIPPED'
  }
  try {
    const result = await cloud.openapi.subscribeMessage.send({ touser: targetUser.openid, page: delivery ? delivery.page : 'pages/notifications/index', templateId: template.templateId, data: templateData(template, payload || {}) })
    await db.collection('notification_deliveries').doc(deliveryId).set({ data: { ...base, attempts: attempts + 1, status: 'SENT', resultCode: String(result.errCode || 0), resultMessage: '发送成功', attemptedAt: db.serverDate(), createdAt: (existingDelivery || {}).createdAt || db.serverDate() } })
    return 'SENT'
  } catch (error) {
    const code = String(error.errCode || error.code || 'SEND_FAILED').slice(0, 40)
    const retryable = ['-1', '45009', 'SYSTEM_ERROR', 'SEND_FAILED'].includes(code), status = retryable && attempts < 1 ? 'PENDING' : 'FAILED'
    await db.collection('notification_deliveries').doc(deliveryId).set({ data: { ...base, attempts: attempts + 1, status, resultCode: code, resultMessage: short(error.errMsg || error.message || '发送失败', 120), attemptedAt: db.serverDate(), createdAt: (existingDelivery || {}).createdAt || db.serverDate() } })
    return status
  }
}
async function processPendingNotifications() {
  const settings = await getSettings()
  const notifications = (await db.collection('notifications').where({ pushStatus: 'PENDING' }).orderBy('createdAt', 'asc').limit(50).get()).data
  for (const notification of notifications) {
    const user = (await db.collection('users').doc(notification.recipientUserId).get().catch(() => ({ data: null }))).data
    const deliveryId = safeId(`${notification._id}_wechat`)
    const status = await sendSubscription({ deliveryId, notification, settings, user })
    await db.collection('notifications').doc(notification._id).update({ data: { pushStatus: status, updatedAt: db.serverDate() } })
  }
  const deliveries = (await db.collection('notification_deliveries').where({ status: 'PENDING' }).orderBy('createdAt', 'asc').limit(50).get()).data
  for (const delivery of deliveries) await sendSubscription({ deliveryId: delivery._id, delivery, settings })
  return { notifications: notifications.length, deliveries: deliveries.length }
}
async function runTimer() {
  const reminders = await scanReminders()
  const deliveries = await processPendingNotifications()
  return ok({ reminders, ...deliveries })
}

exports.main = async event => {
  try {
    const wxContext = cloud.getWXContext()
    if (!wxContext.OPENID && event && event.Type === 'Timer') return runTimer()
    if (event.action === 'subscriptionTemplates') return subscriptionTemplates()
    const user = await currentUser(wxContext.OPENID)
    if (!user || user.status === 'DISABLED') return fail('用户身份无效')
    if (event.action === 'summary') return ok(await summary(user))
    if (event.action === 'list') return ok(await listMessages(event, user))
    if (event.action === 'markRead') return markRead(event, user)
    if (event.action === 'markAllRead') return markAllRead(user)
    if (event.action === 'saveSubscriptionResult') return saveSubscriptionResult(event, user)
    if (!isAdmin(user)) return fail('无管理员权限')
    if (event.action === 'adminListAnnouncements') return adminListAnnouncements(event)
    if (event.action === 'adminPublishAnnouncement') return adminPublishAnnouncement(event, user)
    if (event.action === 'adminDisableAnnouncement') return adminDisableAnnouncement(event, user)
    if (event.action === 'adminGetSettings') return ok(await getSettings())
    if (event.action === 'adminSaveSettings') return adminSaveSettings(event, user)
    return fail('未知操作')
  } catch (error) {
    console.error('notification service error', { message: error.message })
    return fail('消息服务异常')
  }
}
