const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database(), _ = db.command
const ok = data => ({ ok: true, data }), fail = message => ({ ok: false, message })
const statusText = { BOOKED: '待使用', CANCELLED: '已取消', COMPLETED: '已结束' }
async function user() { const openid = cloud.getWXContext().OPENID; if (!openid) return null; const r = await db.collection('users').where({ openid }).limit(1).get(); return r.data[0] }
function parse(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NaN
  return Date.parse(`${date}T${time}:00+08:00`)
}
function formatTime(ms) { const d = new Date(ms + 8 * 3600000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` }
function dayBounds(date) { const start = parse(date, '00:00'); return [start, start + 86400000] }
async function settings() { return (await db.collection('settings').doc('reservation').get().catch(() => ({ data: {} }))).data }
exports.main = async event => {
  try {
    const me = await user(); if (!me || me.status !== 'APPROVED') return fail('账号尚未通过审核')
    if (event.action === 'availability') {
      const [start, end] = dayBounds(event.date)
      if (!Number.isFinite(start)) return fail('日期格式不正确')
      const [reservationResult, blockResult, rule] = await Promise.all([
        db.collection('reservations').where({ deviceId: event.deviceId, status: 'BOOKED', startAt: _.lt(end), endAt: _.gt(start) }).orderBy('startAt', 'asc').limit(100).get(),
        db.collection('device_blocks').where({ deviceId: event.deviceId, startAt: _.lt(end), endAt: _.gt(start) }).orderBy('startAt', 'asc').limit(100).get(),
        settings()
      ])
      const rows = reservationResult.data
      const otherUserIds = [...new Set(rows.filter(x => x.userId !== me._id).map(x => x.userId))]
      const users = otherUserIds.length ? (await db.collection('users').where({ _id: _.in(otherUserIds) }).field({ _id: true, name: true }).get()).data : []
      const names = Object.fromEntries(users.map(x => [x._id, x.name]))
      return ok({
        maxAdvanceDays: Number(rule.maxAdvanceDays || 7),
        reservations: rows.map(x => ({
          startAt: x.startAt,
          endAt: x.endAt,
          startTime: formatTime(x.startAt),
          endTime: formatTime(x.endAt),
          ownership: x.userId === me._id ? 'MINE' : 'OTHER',
          ownerName: x.userId === me._id ? '' : (names[x.userId] || '实验室成员')
        })),
        blocks: blockResult.data.map(x => ({ startAt: x.startAt, endAt: x.endAt, label: String(x.reason || '维护禁用').slice(0, 20) }))
      })
    }
    if (event.action === 'mine') {
      const now = Date.now(), upcoming = event.scope !== 'HISTORY'
      const condition = upcoming ? { userId: me._id, status: 'BOOKED', endAt: _.gt(now) } : { userId: me._id, endAt: _.lte(now) }
      let rows = (await db.collection('reservations').where(condition).orderBy('startAt', upcoming ? 'asc' : 'desc').limit(100).get()).data
      if (!upcoming) {
        const cancelled = (await db.collection('reservations').where({ userId: me._id, status: 'CANCELLED' }).orderBy('startAt', 'desc').limit(100).get()).data
        rows = [...rows, ...cancelled].sort((a, b) => b.startAt - a.startAt).slice(0, 100)
      }
      const ids = [...new Set(rows.map(x => x.deviceId))], devices = ids.length ? (await db.collection('devices').where({ _id: _.in(ids) }).get()).data : []
      const names = Object.fromEntries(devices.map(x => [x._id, x.name]))
      return ok(rows.map(x => ({ ...x, deviceName: names[x.deviceId] || '设备已移除', statusText: x.status === 'BOOKED' && x.endAt <= now ? '已结束' : statusText[x.status], canCancel: x.status === 'BOOKED' && x.startAt > now })))
    }
    if (event.action === 'cancel') {
      const row = (await db.collection('reservations').doc(event.id).get()).data
      if (!row || (row.userId !== me._id && me.role !== 'ADMIN')) return fail('预约不存在')
      if (row.status !== 'BOOKED' || row.startAt <= Date.now()) return fail('该预约不可取消')
      const rule = await settings()
      if (row.startAt - Date.now() < Number(rule.cancelDeadlineMinutes || 0) * 60000) return fail('已超过取消截止时间')
      await db.collection('reservations').doc(event.id).update({ data: { status: 'CANCELLED', cancelledAt: db.serverDate(), updatedAt: db.serverDate() } })
      return ok(true)
    }
    if (event.action === 'create') {
      const startAt = parse(event.date, event.startTime), endAt = parse(event.date, event.endTime), now = Date.now()
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt >= endAt) return fail('预约时间无效')
      if (startAt <= now) return fail('不能预约过去的时间')
      if (!String(event.reason || '').trim()) return fail('请填写实验内容')
      const rule = await settings(), duration = (endAt - startAt) / 60000
      if (duration < Number(rule.minDurationMinutes || 30)) return fail('预约时长低于最小限制')
      if (duration > Number(rule.maxDurationMinutes || 480)) return fail('预约时长超过最大限制')
      if (startAt - now > Number(rule.maxAdvanceDays || 7) * 86400000) return fail('超过可提前预约天数')
      const device = (await db.collection('devices').doc(event.deviceId).get()).data
      if (!device || device.status !== 'AVAILABLE') return fail('设备当前不可预约')
      const [dayStart, dayEnd] = dayBounds(event.date)
      const own = (await db.collection('reservations').where({ userId: me._id, status: 'BOOKED', startAt: _.gte(dayStart).and(_.lt(dayEnd)) }).get()).data
      const ownMinutes = own.reduce((sum, x) => sum + (x.endAt - x.startAt) / 60000, 0)
      if (ownMinutes + duration > Number(rule.maxDailyMinutes || 240)) return fail('每人每天最多预约 4 小时')
      const active = await db.collection('reservations').where({ userId: me._id, status: 'BOOKED', endAt: _.gt(now) }).count()
      if (active.total >= Number(rule.maxActiveReservations || 3)) return fail('每人最多同时持有 3 个有效预约')
      const blocks = await db.collection('device_blocks').where({ deviceId: event.deviceId, startAt: _.lt(endAt), endAt: _.gt(startAt) }).count()
      if (blocks.total) return fail('该时段设备维护中')
      const lockId = `${event.deviceId}_${event.date}`.replace(/[^a-zA-Z0-9_-]/g, '_')
      await db.runTransaction(async transaction => {
        const lock = transaction.collection('reservation_locks').doc(lockId)
        await lock.set({ data: { deviceId: event.deviceId, date: event.date, touchedAt: db.serverDate() } })
        const conflict = await transaction.collection('reservations').where({ deviceId: event.deviceId, status: 'BOOKED', startAt: _.lt(endAt), endAt: _.gt(startAt) }).limit(1).get()
        if (conflict.data.length) throw new Error('TIME_CONFLICT')
        await transaction.collection('reservations').add({ data: { deviceId: event.deviceId, userId: me._id, date: event.date, startAt, endAt, startTime: event.startTime, endTime: event.endTime, reason: String(event.reason).trim().slice(0, 200), status: 'BOOKED', createdAt: db.serverDate(), updatedAt: db.serverDate() } })
      })
      return ok(true)
    }
    return fail('未知操作')
  } catch (error) { console.error(error); return fail(error.message === 'TIME_CONFLICT' ? '该时段刚刚被预约，请重新选择' : '预约服务异常') }
}
