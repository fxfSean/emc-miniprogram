const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database(), _ = db.command
const ok = data => ({ ok: true, data }), fail = message => ({ ok: false, message })
const statusText = { WAITING: '待使用', IN_USE: '使用中', ENDED: '已结束', CANCELLED: '已取消' }
const DEFAULTS = { minDurationMinutes: 30, maxDurationMinutes: 480, maxDailyMinutes: 240, maxActiveReservations: 3, maxAdvanceDays: 7, cancelDeadlineMinutes: 30, checkInEarlyMinutes: 30, checkInRadiusMeters: 100, maxLocationAccuracyMeters: 150 }
const OCCUPYING_STATUSES = ['BOOKED', 'IN_USE']

async function currentUser() {
  const openid = cloud.getWXContext().OPENID
  if (!openid) return null
  return (await db.collection('users').where({ openid }).limit(1).get()).data[0]
}
function isAdmin(user) { return user && user.role === 'ADMIN' && user.status === 'APPROVED' }
function parse(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NaN
  return Date.parse(`${date}T${time}:00+08:00`)
}
function dayBounds(date) { const start = parse(date, '00:00'); return [start, start + 86400000] }
function formatTime(ms) { const d = new Date(ms + 8 * 3600000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` }
function formatDateTime(ms) {
  if (!Number.isFinite(Number(ms))) return ''
  const d = new Date(Number(ms) + 8 * 3600000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${formatTime(Number(ms))}`
}
function durationLabel(seconds) {
  const value = Math.max(0, Number(seconds) || 0), minutes = Math.round(value / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}
function normalizeRules(value) {
  const source = value || {}, result = {}
  Object.keys(DEFAULTS).forEach(key => { const number = Number(source[key]); result[key] = Number.isFinite(number) ? number : DEFAULTS[key] })
  const site = source.checkInSite || {}
  result.checkInMode = 'GEOFENCE'
  result.checkInSite = { name: String(site.name || '主实验室').slice(0, 30), latitude: site.latitude === null || site.latitude === undefined || site.latitude === '' ? null : Number(site.latitude), longitude: site.longitude === null || site.longitude === undefined || site.longitude === '' ? null : Number(site.longitude) }
  return result
}
async function getRules() { return normalizeRules((await db.collection('settings').doc('reservation').get().catch(() => ({ data: {} }))).data) }
function category(row, now) {
  if (row.status === 'CANCELLED') return 'CANCELLED'
  if (row.status === 'COMPLETED') return 'ENDED'
  if (row.status === 'IN_USE') return 'IN_USE'
  return row.endAt <= now ? 'ENDED' : 'WAITING'
}
function durationText(minutes) { return minutes % 60 === 0 ? `${minutes / 60} 小时` : `${minutes} 分钟` }
function validSite(site) { return Number.isFinite(site.latitude) && site.latitude >= -90 && site.latitude <= 90 && Number.isFinite(site.longitude) && site.longitude >= -180 && site.longitude <= 180 }
function validLocation(location) {
  const value = location || {}, latitude = Number(value.latitude), longitude = Number(value.longitude), accuracy = Number(value.accuracy)
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 && Number.isFinite(accuracy) && accuracy >= 0
}
function distanceMeters(a, b) {
  const rad = value => value * Math.PI / 180, earth = 6371000
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return earth * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}
function actualSeconds(row, now) { return Math.max(0, Math.round((now - Number(row.checkedInAt)) / 1000)) }
function safeId(value) { return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 240) }
async function putReservationNotification(transaction, options) {
  const id = safeId(`${options.event}_${options.reservationId}`)
  await transaction.collection('notifications').doc(id).set({ data: {
    recipientUserId: options.userId,
    type: options.type,
    title: options.title,
    content: options.content,
    businessType: 'RESERVATION',
    businessId: options.reservationId,
    navigation: { page: 'MINE_RESERVATION', params: { id: options.reservationId } },
    templateKey: options.templateKey,
    templatePayload: options.templatePayload,
    pushStatus: 'PENDING',
    readAt: null,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  } })
}
function publicRules(rules) {
  const { checkInSite, ...values } = rules
  return { ...values, checkInConfigured: validSite(checkInSite) }
}

async function createBooking(actor, target, event, source) {
  const startAt = parse(event.date, event.startTime), endAt = parse(event.date, event.endTime), now = Date.now()
  if (!target || target.status !== 'APPROVED') return fail('目标用户当前不可预约')
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt >= endAt) return fail('预约时间无效')
  if (startAt <= now) return fail('不能预约过去的时间')
  const reason = String(event.reason || '').trim()
  if (!reason) return fail('请填写实验内容')
  const rules = await getRules(), duration = (endAt - startAt) / 60000
  if (duration < rules.minDurationMinutes) return fail('预约时长低于最小限制')
  if (duration > rules.maxDurationMinutes) return fail('预约时长超过最大限制')
  if (startAt - now > rules.maxAdvanceDays * 86400000) return fail(`最多可提前 ${rules.maxAdvanceDays} 天预约`)
  const device = (await db.collection('devices').doc(String(event.deviceId || '')).get().catch(() => ({ data: null }))).data
  if (!device || device.status !== 'AVAILABLE') return fail('设备当前不可预约')
  const [dayStart, dayEnd] = dayBounds(event.date)
  const own = (await db.collection('reservations').where({ userId: target._id, status: _.in(OCCUPYING_STATUSES), startAt: _.gte(dayStart).and(_.lt(dayEnd)) }).get()).data
  const ownMinutes = own.reduce((sum, item) => sum + (item.endAt - item.startAt) / 60000, 0)
  if (ownMinutes + duration > rules.maxDailyMinutes) return fail(`每人每天最多预约 ${durationText(rules.maxDailyMinutes)}`)
  const [future, using] = await Promise.all([
    db.collection('reservations').where({ userId: target._id, status: 'BOOKED', endAt: _.gt(now) }).count(),
    db.collection('reservations').where({ userId: target._id, status: 'IN_USE' }).count()
  ])
  if (future.total + using.total >= rules.maxActiveReservations) return fail(`每人最多同时持有 ${rules.maxActiveReservations} 个有效预约`)
  const blocks = await db.collection('device_blocks').where({ deviceId: event.deviceId, startAt: _.lt(endAt), endAt: _.gt(startAt) }).count()
  if (blocks.total) return fail('该时段设备维护或禁用中')
  const lockId = `${event.deviceId}_${event.date}`.replace(/[^a-zA-Z0-9_-]/g, '_')
  await db.runTransaction(async transaction => {
    await transaction.collection('reservation_locks').doc(lockId).set({ data: { deviceId: event.deviceId, date: event.date, touchedAt: db.serverDate() } })
    const conflict = await transaction.collection('reservations').where({ deviceId: event.deviceId, status: _.in(OCCUPYING_STATUSES), startAt: _.lt(endAt), endAt: _.gt(startAt) }).limit(1).get()
    if (conflict.data.length) throw new Error('TIME_CONFLICT')
    const blocked = await transaction.collection('device_blocks').where({ deviceId: event.deviceId, startAt: _.lt(endAt), endAt: _.gt(startAt) }).limit(1).get()
    if (blocked.data.length) throw new Error('BLOCK_CONFLICT')
    const data = { deviceId: event.deviceId, userId: target._id, date: event.date, startAt, endAt, startTime: event.startTime, endTime: event.endTime, reason: reason.slice(0, 200), status: 'BOOKED', bookingSource: source, createdAt: db.serverDate(), updatedAt: db.serverDate() }
    if (source === 'ADMIN') data.bookedByAdminId = actor._id
    const created = await transaction.collection('reservations').add({ data })
    const reservationId = created._id
    const timeText = `${event.date} ${event.startTime}–${event.endTime}`
    await putReservationNotification(transaction, {
      event: 'reservation_created', reservationId, userId: target._id, type: 'RESERVATION_CREATED',
      title: source === 'ADMIN' ? '管理员已为您预约设备' : '预约成功',
      content: `${device.name}，${timeText}`,
      templateKey: 'reservationCreated',
      templatePayload: { device: device.name, time: timeText, note: source === 'ADMIN' ? '管理员代预约' : reason.slice(0, 20) }
    })
  })
  return ok(true)
}

async function availability(event, me) {
  const [start, end] = dayBounds(event.date)
  if (!Number.isFinite(start)) return fail('日期格式不正确')
  const [bookings, blocks, rules] = await Promise.all([
    db.collection('reservations').where({ deviceId: event.deviceId, status: _.in(OCCUPYING_STATUSES), startAt: _.lt(end), endAt: _.gt(start) }).orderBy('startAt', 'asc').limit(100).get(),
    db.collection('device_blocks').where({ deviceId: event.deviceId, startAt: _.lt(end), endAt: _.gt(start) }).orderBy('startAt', 'asc').limit(100).get(),
    getRules()
  ])
  const ids = [...new Set(bookings.data.filter(item => item.userId !== me._id).map(item => item.userId))]
  const users = ids.length ? (await db.collection('users').where({ _id: _.in(ids) }).field({ _id: true, name: true }).get()).data : []
  const names = Object.fromEntries(users.map(item => [item._id, item.name]))
  return ok({
    rules: publicRules(rules),
    maxAdvanceDays: rules.maxAdvanceDays,
    reservations: bookings.data.map(item => ({ startAt: item.startAt, endAt: item.endAt, startTime: formatTime(item.startAt), endTime: formatTime(item.endAt), ownership: item.userId === me._id ? 'MINE' : 'OTHER', ownerName: item.userId === me._id ? '' : (names[item.userId] || '实验室成员') })),
    blocks: blocks.data.map(item => ({ startAt: item.startAt, endAt: item.endAt, label: String(item.reason || '维护禁用').slice(0, 20) }))
  })
}

async function mine(event, me) {
  const now = Date.now(), scopes = ['WAITING', 'IN_USE', 'ENDED', 'CANCELLED', 'UPCOMING', 'HISTORY']
  const scope = scopes.includes(event.scope) ? event.scope : 'WAITING'
  let rows = []
  if (scope === 'WAITING') rows = (await db.collection('reservations').where({ userId: me._id, status: 'BOOKED', endAt: _.gt(now) }).orderBy('startAt', 'asc').limit(100).get()).data
  else if (scope === 'IN_USE') rows = (await db.collection('reservations').where({ userId: me._id, status: 'IN_USE' }).orderBy('startAt', 'asc').limit(100).get()).data
  else if (scope === 'ENDED') {
    const [expired, completed] = await Promise.all([
      db.collection('reservations').where({ userId: me._id, status: 'BOOKED', endAt: _.lte(now) }).orderBy('startAt', 'desc').limit(100).get(),
      db.collection('reservations').where({ userId: me._id, status: 'COMPLETED' }).orderBy('startAt', 'desc').limit(100).get()
    ])
    rows = [...expired.data, ...completed.data].sort((a, b) => b.startAt - a.startAt).slice(0, 100)
  } else if (scope === 'CANCELLED') rows = (await db.collection('reservations').where({ userId: me._id, status: 'CANCELLED' }).orderBy('startAt', 'desc').limit(100).get()).data
  else if (scope === 'UPCOMING') rows = (await db.collection('reservations').where({ userId: me._id, status: 'BOOKED', endAt: _.gt(now) }).orderBy('startAt', 'asc').limit(100).get()).data
  else {
    const [expired, completed, cancelled, using] = await Promise.all([
      db.collection('reservations').where({ userId: me._id, status: 'BOOKED', endAt: _.lte(now) }).orderBy('startAt', 'desc').limit(100).get(),
      db.collection('reservations').where({ userId: me._id, status: 'COMPLETED' }).orderBy('startAt', 'desc').limit(100).get(),
      db.collection('reservations').where({ userId: me._id, status: 'CANCELLED' }).orderBy('startAt', 'desc').limit(100).get(),
      db.collection('reservations').where({ userId: me._id, status: 'IN_USE' }).orderBy('startAt', 'desc').limit(100).get()
    ])
    rows = [...expired.data, ...completed.data, ...cancelled.data, ...using.data].sort((a, b) => b.startAt - a.startAt).slice(0, 100)
  }
  const ids = [...new Set(rows.map(item => item.deviceId))]
  const devices = ids.length ? (await db.collection('devices').where({ _id: _.in(ids) }).get()).data : []
  const names = Object.fromEntries(devices.map(item => [item._id, item.name]))
  const rules = await getRules()
  return ok(rows.map(item => {
    const state = category(item, now), missed = state === 'ENDED' && item.status === 'BOOKED'
    return {
      _id: item._id,
      deviceId: item.deviceId,
      date: item.date,
      startAt: item.startAt,
      endAt: item.endAt,
      startTime: item.startTime,
      endTime: item.endTime,
      reason: String(item.reason || ''),
      status: item.status,
      cancelReason: String(item.cancelReason || ''),
      deviceName: names[item.deviceId] || '设备已移除',
      category: state,
      statusText: missed ? '已结束 · 未签到' : statusText[state],
      canCancel: state === 'WAITING',
      canCheckIn: item.status === 'BOOKED' && now >= item.startAt - rules.checkInEarlyMinutes * 60000 && now < item.endAt,
      canCheckOut: item.status === 'IN_USE',
      checkInHint: item.status === 'BOOKED' && now < item.startAt - rules.checkInEarlyMinutes * 60000 ? `可于 ${formatTime(item.startAt - rules.checkInEarlyMinutes * 60000)} 后签到` : '',
      checkedInAtText: formatDateTime(item.checkedInAt),
      checkedOutAtText: formatDateTime(item.checkedOutAt),
      actualDurationText: item.actualDurationSeconds !== undefined ? durationLabel(item.actualDurationSeconds) : '',
      missed
    }
  }))
}

async function checkInBooking(event, actor, adminOverride) {
  const rules = await getRules(), now = Date.now(), reason = String(event.reason || '').trim()
  let locationAudit = null
  if (adminOverride) {
    if (!reason) return fail('请填写代签到原因')
  } else {
    if (!validSite(rules.checkInSite)) return fail('管理员尚未配置实验室签到位置')
    if (!validLocation(event.location)) return fail('无法获取有效定位，请重新定位')
    const location = { latitude: Number(event.location.latitude), longitude: Number(event.location.longitude), accuracy: Number(event.location.accuracy) }
    if (location.accuracy > rules.maxLocationAccuracyMeters) return fail(`定位误差过大，请移动到开阔位置后重试（需小于 ${rules.maxLocationAccuracyMeters} 米）`)
    const distance = distanceMeters(location, rules.checkInSite)
    if (distance > rules.checkInRadiusMeters) return fail(`当前位置不在实验室签到范围内（允许 ${rules.checkInRadiusMeters} 米）`)
    locationAudit = { ...location, distanceMeters: Math.round(distance), siteName: rules.checkInSite.name }
  }
  await db.runTransaction(async transaction => {
    const ref = transaction.collection('reservations').doc(String(event.id || ''))
    const row = (await ref.get().catch(() => ({ data: null }))).data
    if (!row || (!adminOverride && row.userId !== actor._id)) throw new Error('RESERVATION_NOT_FOUND')
    if (row.status !== 'BOOKED') throw new Error('CHECK_IN_NOT_ALLOWED')
    if (now < row.startAt - rules.checkInEarlyMinutes * 60000) throw new Error('CHECK_IN_TOO_EARLY')
    if (now >= row.endAt) throw new Error('CHECK_IN_EXPIRED')
    const usageLockId = `usage_${row.deviceId}`.replace(/[^a-zA-Z0-9_-]/g, '_')
    await transaction.collection('reservation_locks').doc(usageLockId).set({ data: { deviceId: row.deviceId, touchedAt: db.serverDate() } })
    const occupied = await transaction.collection('reservations').where({ deviceId: row.deviceId, status: 'IN_USE' }).limit(1).get()
    if (occupied.data.length) throw new Error('DEVICE_IN_USE')
    const data = { status: 'IN_USE', checkedInAt: now, checkInSource: adminOverride ? 'ADMIN_OVERRIDE' : 'USER_GEOFENCE', updatedAt: db.serverDate() }
    if (locationAudit) data.checkInLocation = locationAudit
    if (adminOverride) Object.assign(data, { checkInByAdminId: actor._id, checkInOverrideReason: reason.slice(0, 200) })
    await ref.update({ data })
  })
  return ok(true)
}

async function checkOutBooking(event, actor, adminOverride) {
  const reason = String(event.reason || '').trim(), now = Date.now()
  if (adminOverride && !reason) return fail('请填写代签退原因')
  await db.runTransaction(async transaction => {
    const ref = transaction.collection('reservations').doc(String(event.id || ''))
    const row = (await ref.get().catch(() => ({ data: null }))).data
    if (!row || (!adminOverride && row.userId !== actor._id)) throw new Error('RESERVATION_NOT_FOUND')
    if (row.status !== 'IN_USE' || !Number.isFinite(Number(row.checkedInAt))) throw new Error('CHECK_OUT_NOT_ALLOWED')
    const data = { status: 'COMPLETED', checkedOutAt: now, actualDurationSeconds: actualSeconds(row, now), checkOutSource: adminOverride ? 'ADMIN_OVERRIDE' : 'USER', updatedAt: db.serverDate() }
    if (adminOverride) Object.assign(data, { checkOutByAdminId: actor._id, checkOutOverrideReason: reason.slice(0, 200) })
    await ref.update({ data })
  })
  return ok(true)
}

exports.main = async event => {
  try {
    const me = await currentUser()
    if (!me || me.status !== 'APPROVED') return fail('账号尚未通过审核')
    if (event.action === 'availability') return availability(event, me)
    if (event.action === 'mine') return mine(event, me)
    if (event.action === 'create') return createBooking(me, me, event, 'USER')
    if (event.action === 'checkIn') return checkInBooking(event, me, false)
    if (event.action === 'checkOut') return checkOutBooking(event, me, false)
    if (event.action === 'cancel') {
      const rules = await getRules()
      await db.runTransaction(async transaction => {
        const ref = transaction.collection('reservations').doc(String(event.id || ''))
        const row = (await ref.get().catch(() => ({ data: null }))).data
        if (!row || row.userId !== me._id) throw new Error('RESERVATION_NOT_FOUND')
        if (category(row, Date.now()) !== 'WAITING') throw new Error('CANCEL_NOT_ALLOWED')
        if (row.startAt - Date.now() < rules.cancelDeadlineMinutes * 60000) throw new Error('CANCEL_DEADLINE')
        const reason = '用户取消'
        await ref.update({ data: { status: 'CANCELLED', cancelSource: 'USER', cancelledByUserId: me._id, cancelReason: reason, cancelledAt: db.serverDate(), updatedAt: db.serverDate() } })
        const device = (await transaction.collection('devices').doc(row.deviceId).get().catch(() => ({ data: null }))).data
        const deviceName = device ? device.name : '预约设备', timeText = `${row.date || formatDateTime(row.startAt).slice(0, 10)} ${row.startTime || formatTime(row.startAt)}–${row.endTime || formatTime(row.endAt)}`
        await putReservationNotification(transaction, {
          event: 'reservation_cancelled', reservationId: row._id, userId: row.userId, type: 'RESERVATION_CANCELLED', title: '预约已取消',
          content: `${deviceName}，${timeText}`,
          templateKey: 'reservationCancelled', templatePayload: { device: deviceName, time: timeText, reason }
        })
      })
      return ok(true)
    }
    if (event.action === 'adminCreate') {
      if (!isAdmin(me)) return fail('无管理员权限')
      const target = (await db.collection('users').doc(String(event.userId || '')).get().catch(() => ({ data: null }))).data
      if (!target || target.role === 'ADMIN') return fail('请选择已通过审核的普通用户')
      return createBooking(me, target, event, 'ADMIN')
    }
    if (event.action === 'adminCheckIn') {
      if (!isAdmin(me)) return fail('无管理员权限')
      return checkInBooking(event, me, true)
    }
    if (event.action === 'adminCheckOut') {
      if (!isAdmin(me)) return fail('无管理员权限')
      return checkOutBooking(event, me, true)
    }
    if (event.action === 'adminCancel') {
      if (!isAdmin(me)) return fail('无管理员权限')
      const reason = String(event.reason || '').trim()
      if (!reason) return fail('请填写取消原因')
      await db.runTransaction(async transaction => {
        const ref = transaction.collection('reservations').doc(String(event.id || ''))
        const row = (await ref.get().catch(() => ({ data: null }))).data
        if (!row || !['BOOKED', 'IN_USE'].includes(row.status)) throw new Error('CANCEL_NOT_ALLOWED')
        const now = Date.now(), data = { status: 'CANCELLED', cancelSource: 'ADMIN', cancelledByUserId: me._id, cancelReason: reason.slice(0, 200), cancelledAt: now, updatedAt: db.serverDate() }
        if (row.status === 'IN_USE' && Number.isFinite(Number(row.checkedInAt))) Object.assign(data, { checkedOutAt: now, actualDurationSeconds: actualSeconds(row, now), checkOutSource: 'ADMIN_CANCEL' })
        await ref.update({ data })
        const device = (await transaction.collection('devices').doc(row.deviceId).get().catch(() => ({ data: null }))).data
        const deviceName = device ? device.name : '预约设备', timeText = `${row.date || formatDateTime(row.startAt).slice(0, 10)} ${row.startTime || formatTime(row.startAt)}–${row.endTime || formatTime(row.endAt)}`
        await putReservationNotification(transaction, {
          event: 'reservation_cancelled', reservationId: row._id, userId: row.userId, type: 'RESERVATION_CANCELLED', title: '管理员取消了您的预约',
          content: `${deviceName}，原因：${reason.slice(0, 80)}`,
          templateKey: 'reservationCancelled', templatePayload: { device: deviceName, time: timeText, reason: reason.slice(0, 20) }
        })
      })
      return ok(true)
    }
    return fail('未知操作')
  } catch (error) {
    console.error(error)
    if (error.message === 'TIME_CONFLICT') return fail('该时段刚刚被预约，请重新选择')
    if (error.message === 'BLOCK_CONFLICT') return fail('该时段刚刚被设为不可用，请重新选择')
    if (error.message === 'RESERVATION_NOT_FOUND') return fail('预约不存在')
    if (error.message === 'CANCEL_NOT_ALLOWED') return fail('该预约不可取消')
    if (error.message === 'CANCEL_DEADLINE') return fail('已超过取消截止时间')
    if (error.message === 'CHECK_IN_NOT_ALLOWED') return fail('该预约当前不可签到')
    if (error.message === 'CHECK_IN_TOO_EARLY') return fail('尚未到签到时间')
    if (error.message === 'CHECK_IN_EXPIRED') return fail('预约时段已结束，无法签到')
    if (error.message === 'DEVICE_IN_USE') return fail('该设备当前已有用户签到使用，请联系管理员')
    if (error.message === 'CHECK_OUT_NOT_ALLOWED') return fail('该预约当前不可签退')
    return fail('预约服务异常')
  }
}
