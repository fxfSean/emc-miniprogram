const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database(), _ = db.command
const ok = data => ({ ok: true, data }), fail = message => ({ ok: false, message })
async function admin() { const openid = cloud.getWXContext().OPENID; if (!openid) return null; const r = await db.collection('users').where({ openid, role: 'ADMIN', status: 'APPROVED' }).limit(1).get(); return r.data[0] }
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
    if (event.action === 'reviewUser') {
      if (!['APPROVED', 'REJECTED'].includes(event.decision)) return fail('审核状态无效')
      await db.collection('users').doc(event.id).update({ data: { status: event.decision, reviewNote: String(event.note || ''), reviewedBy: me._id, reviewedAt: db.serverDate(), updatedAt: db.serverDate() } })
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
    return fail('未知操作')
  } catch (error) { console.error(error); return fail('管理服务异常') }
}
