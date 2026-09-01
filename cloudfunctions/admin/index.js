const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database(), _ = db.command
const ok = data => ({ ok: true, data }), fail = message => ({ ok: false, message })
const USER_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'DISABLED']
const RESERVATION_STATUS_TEXT = { WAITING: '待使用', IN_USE: '使用中', ENDED: '已结束', CANCELLED: '已取消' }
const RULE_DEFAULTS = { maxDailyMinutes: 240, maxActiveReservations: 3, maxAdvanceDays: 7, cancelDeadlineMinutes: 30, checkInEarlyMinutes: 30, checkInRadiusMeters: 100, maxLocationAccuracyMeters: 150 }
const OCCUPYING_STATUSES = ['BOOKED', 'IN_USE']
async function admin() { const openid = cloud.getWXContext().OPENID; if (!openid) return null; const r = await db.collection('users').where({ openid, role: 'ADMIN', status: 'APPROVED' }).limit(1).get(); return r.data[0] }
async function allReviewUsers() {
  const users = []
  let offset = 0
  while (true) {
    const batch = (await db.collection('users').orderBy('createdAt', 'desc').skip(offset).limit(100).get()).data
    users.push(...batch)
    if (batch.length < 100) break
    offset += batch.length
  }
  return users.filter(user => USER_STATUSES.includes(user.status))
}
function publicUser(user) {
  return {
    _id: user._id,
    name: String(user.name || ''),
    studentNo: String(user.studentNo || ''),
    advisor: String(user.advisor || ''),
    phone: String(user.phone || ''),
    role: user.role === 'ADMIN' ? 'ADMIN' : 'USER',
    status: user.status,
    reviewNote: String(user.reviewNote || '')
  }
}
function dayRange() {
  const local = new Date(Date.now() + 8 * 3600000)
  const date = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`
  const start = Date.parse(`${date}T00:00:00+08:00`)
  return [start, start + 86400000]
}
function reservationCategory(row, now = Date.now()) {
  if (row.status === 'CANCELLED') return 'CANCELLED'
  if (row.status === 'COMPLETED') return 'ENDED'
  if (row.status === 'IN_USE') return 'IN_USE'
  return row.endAt <= now ? 'ENDED' : 'WAITING'
}
function formatDate(ms) {
  const value = ms instanceof Date ? ms.getTime() : Number(ms)
  const date = new Date(value + 8 * 3600000)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}
function formatDateTime(ms) {
  const value = ms instanceof Date ? ms.getTime() : Number(ms)
  const date = new Date(value + 8 * 3600000)
  return `${formatDate(ms)} ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}
function durationText(seconds) {
  const minutes = Math.round(Math.max(0, Number(seconds) || 0) / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}
function safeId(value) { return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 240) }
async function putNotification(target, options) {
  await target.collection('notifications').doc(safeId(options.id)).set({ data: {
    recipientUserId: options.userId,
    type: options.type,
    title: options.title,
    content: options.content,
    businessType: options.businessType,
    businessId: options.businessId,
    navigation: options.navigation,
    templateKey: options.templateKey,
    templatePayload: options.templatePayload,
    pushStatus: 'PENDING',
    readAt: null,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  } })
}
function validRange(startAt, endAt, maxDays = 366) {
  return Number.isFinite(startAt) && Number.isFinite(endAt) && startAt < endAt && endAt - startAt <= maxDays * 86400000
}
async function queryReservations(startAt, endAt, deviceId) {
  const rows = []
  let offset = 0
  while (true) {
    const startFloor = startAt - 86400000
    const where = deviceId ? { deviceId, startAt: _.gte(startFloor).and(_.lt(endAt)) } : { startAt: _.gte(startFloor).and(_.lt(endAt)) }
    const batch = (await db.collection('reservations').where(where).orderBy('startAt', 'desc').skip(offset).limit(100).get()).data
    rows.push(...batch.filter(item => item.endAt > startAt))
    if (batch.length < 100) break
    offset += batch.length
  }
  return rows
}
async function enrichReservations(rows) {
  const userIds = [...new Set(rows.map(item => item.userId).filter(Boolean))]
  const deviceIds = [...new Set(rows.map(item => item.deviceId).filter(Boolean))]
  const [users, devices] = await Promise.all([
    userIds.length ? db.collection('users').where({ _id: _.in(userIds) }).field({ _id: true, name: true, studentNo: true }).get() : { data: [] },
    deviceIds.length ? db.collection('devices').where({ _id: _.in(deviceIds) }).field({ _id: true, name: true, deviceNo: true }).get() : { data: [] }
  ])
  const userMap = Object.fromEntries(users.data.map(item => [item._id, item]))
  const deviceMap = Object.fromEntries(devices.data.map(item => [item._id, item]))
  const rules = normalizeRules((await db.collection('settings').doc('reservation').get().catch(() => ({ data: {} }))).data)
  const now = Date.now()
  return rows.map(item => {
    const state = reservationCategory(item), owner = userMap[item.userId] || {}, device = deviceMap[item.deviceId] || {}
    const missed = state === 'ENDED' && item.status === 'BOOKED'
    return {
      _id: item._id,
      userId: item.userId,
      userName: owner.name || '用户已移除',
      studentNo: owner.studentNo || '',
      deviceId: item.deviceId,
      deviceName: device.name || '设备已移除',
      deviceNo: device.deviceNo || '',
      date: item.date || formatDate(item.startAt),
      startAt: item.startAt,
      endAt: item.endAt,
      timeText: `${formatDateTime(item.startAt).slice(11)}–${formatDateTime(item.endAt).slice(11)}`,
      reason: String(item.reason || ''),
      reasonSummary: String(item.reason || '').slice(0, 36),
      category: state,
      statusText: missed ? '已结束 · 未签到' : RESERVATION_STATUS_TEXT[state],
      canCancel: item.status === 'BOOKED' || item.status === 'IN_USE',
      canAdminCheckIn: item.status === 'BOOKED' && now >= item.startAt - rules.checkInEarlyMinutes * 60000 && now < item.endAt,
      canAdminCheckOut: item.status === 'IN_USE',
      createdAt: item.createdAt,
      createdAtText: item.createdAt ? formatDateTime(item.createdAt) : '',
      bookingSource: item.bookingSource || 'USER',
      cancelSource: item.cancelSource || '',
      cancelReason: String(item.cancelReason || ''),
      checkedInAt: item.checkedInAt,
      checkedOutAt: item.checkedOutAt,
      checkedInAtText: item.checkedInAt ? formatDateTime(item.checkedInAt) : '',
      checkedOutAtText: item.checkedOutAt ? formatDateTime(item.checkedOutAt) : '',
      actualDurationSeconds: Number(item.actualDurationSeconds) || 0,
      actualDurationText: item.checkedInAt ? durationText(item.actualDurationSeconds || (item.status === 'IN_USE' ? (Date.now() - Number(item.checkedInAt)) / 1000 : 0)) : '',
      checkInDistanceMeters: item.checkInLocation ? Number(item.checkInLocation.distanceMeters) : null,
      checkInSiteName: item.checkInLocation ? String(item.checkInLocation.siteName || '') : '',
      checkInSourceText: item.checkInSource === 'ADMIN_OVERRIDE' ? '管理员代签到' : (item.checkInSource ? '用户定位签到' : ''),
      checkOutSourceText: item.checkOutSource === 'ADMIN_OVERRIDE' ? '管理员代签退' : (item.checkOutSource === 'ADMIN_CANCEL' ? '管理员取消结束' : (item.checkOutSource ? '用户签退' : '')),
      checkInOverrideReason: String(item.checkInOverrideReason || ''),
      checkOutOverrideReason: String(item.checkOutOverrideReason || ''),
      missed
    }
  })
}
function normalizeRules(value) {
  const source = value || {}, result = {}
  Object.keys(RULE_DEFAULTS).forEach(key => { const number = Number(source[key]); result[key] = Number.isFinite(number) ? number : RULE_DEFAULTS[key] })
  const site = source.checkInSite || {}
  result.checkInMode = 'GEOFENCE'
  result.checkInSite = { name: String(site.name || '主实验室').slice(0, 30), latitude: site.latitude === null || site.latitude === undefined || site.latitude === '' ? null : Number(site.latitude), longitude: site.longitude === null || site.longitude === undefined || site.longitude === '' ? null : Number(site.longitude) }
  return result
}
function validSite(site) { return Number.isFinite(site.latitude) && site.latitude >= -90 && site.latitude <= 90 && Number.isFinite(site.longitude) && site.longitude >= -180 && site.longitude <= 180 }
function dateKeys(startAt, endAt) {
  const keys = []
  let cursor = Date.parse(`${formatDate(startAt)}T00:00:00+08:00`)
  while (cursor < endAt) { keys.push(formatDate(cursor)); cursor += 86400000 }
  return keys
}
exports.main = async event => {
  try {
    const me = await admin(); if (!me) return fail('无管理员权限')
    if (event.action === 'summary') {
      const [start, end] = dayRange()
      const [pending, devices, bookings] = await Promise.all([
        db.collection('users').where({ status: 'PENDING' }).count(), db.collection('devices').count(),
        db.collection('reservations').where({ startAt: _.gte(start).and(_.lt(end)), status: _.in(OCCUPYING_STATUSES) }).count()
      ])
      return ok({ pendingUsers: pending.total, devices: devices.total, todayReservations: bookings.total })
    }
    if (event.action === 'pendingUsers') return ok((await db.collection('users').where({ status: 'PENDING' }).orderBy('createdAt', 'asc').limit(100).get()).data)
    if (event.action === 'listUsers') {
      const selectedStatus = String(event.status || 'ALL').toUpperCase()
      if (selectedStatus !== 'ALL' && !USER_STATUSES.includes(selectedStatus)) return fail('用户状态无效')
      const keyword = String(event.keyword || '').trim().toLowerCase().slice(0, 50)
      let users = await allReviewUsers()
      if (keyword) users = users.filter(user =>
        String(user.name || '').toLowerCase().includes(keyword) ||
        String(user.studentNo || '').toLowerCase().includes(keyword)
      )
      const counts = {
        ALL: users.length,
        PENDING: users.filter(user => user.status === 'PENDING').length,
        APPROVED: users.filter(user => user.status === 'APPROVED').length,
        REJECTED: users.filter(user => user.status === 'REJECTED').length,
        DISABLED: users.filter(user => user.status === 'DISABLED').length
      }
      if (selectedStatus !== 'ALL') users = users.filter(user => user.status === selectedStatus)
      return ok({ users: users.map(publicUser), counts })
    }
    if (event.action === 'reviewUser') {
      if (!['APPROVED', 'REJECTED'].includes(event.decision)) return fail('审核状态无效')
      const note = String(event.note || '').trim().slice(0, 200)
      if (event.decision === 'REJECTED' && !note) return fail('请填写拒绝原因')
      await db.runTransaction(async transaction => {
        const ref = transaction.collection('users').doc(String(event.id || ''))
        const user = (await ref.get().catch(() => ({ data: null }))).data
        if (!user || user.role === 'ADMIN') throw new Error('REVIEW_USER_NOT_FOUND')
        if (user.status !== 'PENDING') throw new Error('REVIEW_NOT_ALLOWED')
        const reviewVersion = Math.max(0, Number(user.reviewVersion) || 0) + 1
        await ref.update({ data: { status: event.decision, reviewNote: note, reviewVersion, reviewedBy: me._id, reviewedAt: db.serverDate(), updatedAt: db.serverDate() } })
        const approved = event.decision === 'APPROVED', resultText = approved ? '审核已通过' : '审核未通过'
        await putNotification(transaction, {
          id: `review_${user._id}_${reviewVersion}`, userId: user._id, type: 'REVIEW_RESULT', title: resultText,
          content: approved ? '您的实验室成员资料已通过审核，可以预约设备。' : `未通过原因：${note}`,
          businessType: 'USER', businessId: user._id, navigation: { page: 'PROFILE_STATUS', params: {} },
          templateKey: 'review', templatePayload: { result: resultText, approver: me.name || '实验室管理员', time: formatDateTime(Date.now()), note: approved ? '可以开始预约设备' : note.slice(0, 20) }
        })
      })
      return ok(true)
    }
    if (event.action === 'setUserEnabled') {
      const id = String(event.id || '').trim()
      if (!id || typeof event.enabled !== 'boolean') return fail('账号状态参数无效')
      const target = (await db.collection('users').doc(id).get().catch(() => ({ data: null }))).data
      if (!target) return fail('用户不存在')
      if (target.role === 'ADMIN') return fail('管理员账号不可禁用')
      if (event.enabled && target.status !== 'DISABLED') return fail('仅已禁用用户可以启用')
      if (!event.enabled && target.status !== 'APPROVED') return fail('仅已通过用户可以禁用')
      const data = { status: event.enabled ? 'APPROVED' : 'DISABLED', updatedAt: db.serverDate() }
      if (event.enabled) Object.assign(data, { enabledBy: me._id, enabledAt: db.serverDate() })
      else Object.assign(data, { disabledBy: me._id, disabledAt: db.serverDate() })
      await db.collection('users').doc(id).update({ data })
      return ok(true)
    }
    if (event.action === 'reservationCalendar') {
      const month = String(event.month || '')
      if (!/^\d{4}-\d{2}$/.test(month)) return fail('月份格式无效')
      const startAt = Date.parse(`${month}-01T00:00:00+08:00`)
      const local = new Date(startAt + 8 * 3600000)
      const nextMonth = local.getUTCMonth() === 11 ? `${local.getUTCFullYear() + 1}-01` : `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 2).padStart(2, '0')}`
      const endAt = Date.parse(`${nextMonth}-01T00:00:00+08:00`)
      const rows = await queryReservations(startAt, endAt, String(event.deviceId || '').trim())
      const counts = {}
      rows.forEach(item => { const date = item.date || formatDate(item.startAt); counts[date] = (counts[date] || 0) + 1 })
      return ok({ counts, total: rows.length })
    }
    if (event.action === 'listReservations') {
      const startAt = Number(event.startAt), endAt = Number(event.endAt)
      if (!validRange(startAt, endAt)) return fail('预约查询日期范围无效')
      const page = Math.max(1, Number(event.page) || 1), pageSize = Math.min(50, Math.max(1, Number(event.pageSize) || 20))
      const rows = await queryReservations(startAt, endAt, String(event.deviceId || '').trim())
      const offset = (page - 1) * pageSize
      const items = await enrichReservations(rows.slice(offset, offset + pageSize))
      const summaryNow = Date.now()
      const summary = {
        checkedInCount: rows.filter(item => item.checkedInAt).length,
        completedCount: rows.filter(item => item.status === 'COMPLETED').length,
        actualDurationSeconds: rows.reduce((sum, item) => sum + (Number(item.actualDurationSeconds) || (item.status === 'IN_USE' && item.checkedInAt ? Math.max(0, Math.round((summaryNow - Number(item.checkedInAt)) / 1000)) : 0)), 0)
      }
      summary.actualDurationText = durationText(summary.actualDurationSeconds)
      return ok({ items, total: rows.length, page, pageSize, hasMore: offset + pageSize < rows.length, summary })
    }
    if (event.action === 'reservationDetail') {
      const row = (await db.collection('reservations').doc(String(event.id || '')).get().catch(() => ({ data: null }))).data
      if (!row) return fail('预约不存在')
      return ok((await enrichReservations([row]))[0])
    }
    if (event.action === 'listDeviceBlocks') {
      const startAt = Number(event.startAt), endAt = Number(event.endAt)
      if (!validRange(startAt, endAt)) return fail('禁用时段查询范围无效')
      const deviceId = String(event.deviceId || '').trim(), rows = []
      let offset = 0
      while (true) {
        const where = deviceId ? { deviceId, startAt: _.lt(endAt) } : { startAt: _.lt(endAt) }
        const batch = (await db.collection('device_blocks').where(where).orderBy('startAt', 'desc').skip(offset).limit(100).get()).data
        rows.push(...batch.filter(item => item.endAt > startAt))
        if (batch.length < 100) break
        offset += batch.length
      }
      const deviceIds = [...new Set(rows.map(item => item.deviceId))]
      const devices = deviceIds.length ? (await db.collection('devices').where({ _id: _.in(deviceIds) }).field({ _id: true, name: true, deviceNo: true }).get()).data : []
      const names = Object.fromEntries(devices.map(item => [item._id, item]))
      return ok(rows.map(item => ({ ...item, category: ['MAINTENANCE', 'HOLIDAY', 'OTHER'].includes(item.category) ? item.category : 'OTHER', deviceName: (names[item.deviceId] || {}).name || '设备已移除', deviceNo: (names[item.deviceId] || {}).deviceNo || '', startText: formatDateTime(item.startAt), endText: formatDateTime(item.endAt) })))
    }
    if (event.action === 'createDeviceBlock') {
      const deviceId = String(event.deviceId || '').trim(), startAt = Number(event.startAt), endAt = Number(event.endAt)
      const category = ['MAINTENANCE', 'HOLIDAY', 'OTHER'].includes(event.category) ? event.category : 'OTHER'
      const reason = String(event.reason || '').trim()
      if (!deviceId || !validRange(startAt, endAt, 31)) return fail('禁用时段参数无效，单次最多设置 31 天')
      if (!reason) return fail('请填写禁用原因')
      const device = (await db.collection('devices').doc(deviceId).get().catch(() => ({ data: null }))).data
      if (!device) return fail('设备不存在')
      const keys = dateKeys(startAt, endAt)
      await db.runTransaction(async transaction => {
        for (const date of keys) {
          const lockId = `${deviceId}_${date}`.replace(/[^a-zA-Z0-9_-]/g, '_')
          await transaction.collection('reservation_locks').doc(lockId).set({ data: { deviceId, date, touchedAt: db.serverDate() } })
        }
        const booking = await transaction.collection('reservations').where({ deviceId, status: _.in(OCCUPYING_STATUSES), startAt: _.lt(endAt), endAt: _.gt(startAt) }).limit(1).get()
        if (booking.data.length) throw new Error('BLOCK_BOOKING_CONFLICT')
        const block = await transaction.collection('device_blocks').where({ deviceId, startAt: _.lt(endAt), endAt: _.gt(startAt) }).limit(1).get()
        if (block.data.length) throw new Error('BLOCK_RANGE_CONFLICT')
        await transaction.collection('device_blocks').add({ data: { deviceId, startAt, endAt, category, reason: reason.slice(0, 100), createdBy: me._id, createdAt: db.serverDate(), updatedAt: db.serverDate() } })
      })
      return ok(true)
    }
    if (event.action === 'deleteDeviceBlock') {
      const id = String(event.id || '').trim()
      if (!id) return fail('禁用时段参数无效')
      const removed = await db.collection('device_blocks').doc(id).remove()
      if (!removed.stats || removed.stats.removed !== 1) return fail('禁用时段不存在')
      console.log('device block reopened', { id, adminId: me._id })
      return ok(true)
    }
    if (event.action === 'getReservationSettings') {
      const data = (await db.collection('settings').doc('reservation').get().catch(() => ({ data: {} }))).data
      return ok(normalizeRules(data))
    }
    if (event.action === 'saveReservationSettings') {
      const values = {
        maxDailyMinutes: Number(event.maxDailyMinutes),
        maxActiveReservations: Number(event.maxActiveReservations),
        maxAdvanceDays: Number(event.maxAdvanceDays),
        cancelDeadlineMinutes: Number(event.cancelDeadlineMinutes),
        checkInEarlyMinutes: Number(event.checkInEarlyMinutes),
        checkInRadiusMeters: Number(event.checkInRadiusMeters),
        maxLocationAccuracyMeters: Number(event.maxLocationAccuracyMeters),
        checkInMode: 'GEOFENCE',
        checkInSite: {
          name: String((event.checkInSite || {}).name || '主实验室').trim().slice(0, 30),
          latitude: (event.checkInSite || {}).latitude === null || (event.checkInSite || {}).latitude === undefined || (event.checkInSite || {}).latitude === '' ? NaN : Number((event.checkInSite || {}).latitude),
          longitude: (event.checkInSite || {}).longitude === null || (event.checkInSite || {}).longitude === undefined || (event.checkInSite || {}).longitude === '' ? NaN : Number((event.checkInSite || {}).longitude)
        }
      }
      if (!Number.isInteger(values.maxDailyMinutes) || values.maxDailyMinutes < 30 || values.maxDailyMinutes > 1440 || values.maxDailyMinutes % 30) return fail('每日最大预约时长须为 30–1440 分钟且按 30 分钟递增')
      if (!Number.isInteger(values.maxActiveReservations) || values.maxActiveReservations < 1 || values.maxActiveReservations > 20) return fail('最多有效预约数须为 1–20')
      if (!Number.isInteger(values.maxAdvanceDays) || values.maxAdvanceDays < 1 || values.maxAdvanceDays > 90) return fail('提前预约天数须为 1–90')
      if (!Number.isInteger(values.cancelDeadlineMinutes) || values.cancelDeadlineMinutes < 0 || values.cancelDeadlineMinutes > 10080) return fail('取消截止时间须为 0–10080 分钟')
      if (!Number.isInteger(values.checkInEarlyMinutes) || values.checkInEarlyMinutes < 0 || values.checkInEarlyMinutes > 180) return fail('提前签到时间须为 0–180 分钟')
      if (!Number.isInteger(values.checkInRadiusMeters) || values.checkInRadiusMeters < 20 || values.checkInRadiusMeters > 2000) return fail('签到范围须为 20–2000 米')
      if (!Number.isInteger(values.maxLocationAccuracyMeters) || values.maxLocationAccuracyMeters < 20 || values.maxLocationAccuracyMeters > 2000) return fail('最大定位误差须为 20–2000 米')
      if (!values.checkInSite.name) return fail('请填写签到位置名称')
      if (!validSite(values.checkInSite)) return fail('请先使用当前位置设置有效的实验室坐标')
      const existing = (await db.collection('settings').doc('reservation').get().catch(() => ({ data: null }))).data
      const settingsRef = db.collection('settings').doc('reservation')
      const data = { ...values, updatedBy: me._id, updatedAt: db.serverDate() }
      if (existing) await settingsRef.update({ data })
      else await settingsRef.set({ data })
      return ok(values)
    }
    if (event.action === 'saveDevice') {
      const item = event.device || {}, allowed = ['AVAILABLE', 'MAINTENANCE', 'DISABLED']
      if (!String(item.deviceNo || '').trim() || !String(item.name || '').trim()) return fail('编号和名称为必填项')
      if (!allowed.includes(item.status)) return fail('设备状态无效')
      const sameNumber = await db.collection('devices').where({ deviceNo: item.deviceNo.trim() }).limit(10).get()
      if (sameNumber.data.some(x => x._id !== item._id)) return fail('设备编号已存在')
      const data = { deviceNo: item.deviceNo.trim(), name: item.name.trim(), model: String(item.model || '').trim(), manufacturer: String(item.manufacturer || '').trim(), location: String(item.location || '').trim(), description: String(item.description || '').trim(), status: item.status, updatedAt: db.serverDate() }
      if (item._id) {
        await db.runTransaction(async transaction => {
          const ref = transaction.collection('devices').doc(item._id)
          const current = (await ref.get().catch(() => ({ data: null }))).data
          if (!current) throw new Error('DEVICE_NOT_FOUND')
          const entersMaintenance = current.status !== 'MAINTENANCE' && item.status === 'MAINTENANCE'
          const maintenanceVersion = entersMaintenance ? Math.max(0, Number(current.maintenanceVersion) || 0) + 1 : Math.max(0, Number(current.maintenanceVersion) || 0)
          await ref.update({ data: { ...data, maintenanceVersion } })
          if (entersMaintenance) {
            const reservations = await transaction.collection('reservations').where({ deviceId: item._id, status: 'BOOKED', startAt: _.gt(Date.now()) }).limit(100).get()
            const userIds = [...new Set(reservations.data.map(row => row.userId).filter(Boolean))]
            for (const userId of userIds) {
              await putNotification(transaction, {
                id: `device_maintenance_${item._id}_${maintenanceVersion}_${userId}`, userId, type: 'DEVICE_MAINTENANCE', title: '预约设备进入维护状态',
                content: `${item.name.trim()}当前进入维护状态，请留意预约安排或联系管理员。`,
                businessType: 'DEVICE', businessId: item._id, navigation: { page: 'DEVICE_DETAIL', params: { id: item._id } },
                templateKey: 'maintenance', templatePayload: { device: item.name.trim(), time: formatDateTime(Date.now()), reason: '设备维护，请联系管理员' }
              })
            }
          }
        })
      } else await db.collection('devices').add({ data: { ...data, maintenanceVersion: item.status === 'MAINTENANCE' ? 1 : 0, createdAt: db.serverDate() } })
      return ok(true)
    }
    if (event.action === 'deleteDevice') {
      const id = String(event.id || '').trim()
      if (!id) return fail('设备参数无效')
      const device = (await db.collection('devices').doc(id).get().catch(() => ({ data: null }))).data
      if (!device) return fail('设备不存在')
      const [reservations, blocks] = await Promise.all([
        db.collection('reservations').where({ deviceId: id }).count(),
        db.collection('device_blocks').where({ deviceId: id }).count()
      ])
      if (reservations.total > 0) return fail('该设备存在关联预约，无法删除')
      if (blocks.total > 0) return fail('该设备存在维护或禁用时段，无法删除')
      const removed = await db.collection('devices').doc(id).remove()
      if (!removed.stats || removed.stats.removed !== 1) return fail('设备删除失败')
      return ok(true)
    }
    return fail('未知操作')
  } catch (error) {
    console.error(error)
    if (error.message === 'BLOCK_BOOKING_CONFLICT') return fail('该时段存在有效预约，请先取消冲突预约')
    if (error.message === 'BLOCK_RANGE_CONFLICT') return fail('该时段已存在维护或禁用安排')
    if (error.message === 'REVIEW_USER_NOT_FOUND') return fail('待审核用户不存在')
    if (error.message === 'REVIEW_NOT_ALLOWED') return fail('该用户当前不可重复审核')
    if (error.message === 'DEVICE_NOT_FOUND') return fail('设备不存在')
    return fail('管理服务异常')
  }
}
