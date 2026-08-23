const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database(), _ = db.command
const ok = data => ({ ok: true, data }), fail = message => ({ ok: false, message })
const USER_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'DISABLED']
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
exports.main = async event => {
  try {
    const me = await admin(); if (!me) return fail('无管理员权限')
    if (event.action === 'summary') {
      const [start, end] = dayRange()
      const [pending, devices, bookings] = await Promise.all([
        db.collection('users').where({ status: 'PENDING' }).count(), db.collection('devices').count(),
        db.collection('reservations').where({ startAt: _.gte(start).and(_.lt(end)), status: 'BOOKED' }).count()
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
      await db.collection('users').doc(event.id).update({ data: { status: event.decision, reviewNote: String(event.note || ''), reviewedBy: me._id, reviewedAt: db.serverDate(), updatedAt: db.serverDate() } })
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
    if (event.action === 'saveDevice') {
      const item = event.device || {}, allowed = ['AVAILABLE', 'MAINTENANCE', 'DISABLED']
      if (!String(item.deviceNo || '').trim() || !String(item.name || '').trim()) return fail('编号和名称为必填项')
      if (!allowed.includes(item.status)) return fail('设备状态无效')
      const sameNumber = await db.collection('devices').where({ deviceNo: item.deviceNo.trim() }).limit(10).get()
      if (sameNumber.data.some(x => x._id !== item._id)) return fail('设备编号已存在')
      const data = { deviceNo: item.deviceNo.trim(), name: item.name.trim(), model: String(item.model || '').trim(), manufacturer: String(item.manufacturer || '').trim(), location: String(item.location || '').trim(), description: String(item.description || '').trim(), status: item.status, updatedAt: db.serverDate() }
      if (item._id) await db.collection('devices').doc(item._id).update({ data })
      else await db.collection('devices').add({ data: { ...data, createdAt: db.serverDate() } })
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
  } catch (error) { console.error(error); return fail('管理服务异常') }
}
