const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database(), _ = db.command
const labels = { AVAILABLE: '可预约', MAINTENANCE: '维护中', DISABLED: '已停用' }
const ok = data => ({ ok: true, data }), fail = message => ({ ok: false, message })
async function currentUser() { const openid = cloud.getWXContext().OPENID; const r = await db.collection('users').where({ openid }).limit(1).get(); return r.data[0] }
exports.main = async event => {
  try {
    const user = await currentUser()
    if (!user || user.status !== 'APPROVED') return fail('账号尚未通过审核')
    if (event.action === 'list') {
      let query = db.collection('devices')
      if (!(event.includeDisabled && user.role === 'ADMIN')) query = query.where({ status: _.neq('DISABLED') })
      let data = (await query.orderBy('deviceNo', 'asc').limit(100).get()).data
      const keyword = String(event.keyword || '').trim().toLowerCase()
      if (keyword) data = data.filter(x => [x.name, x.deviceNo, x.model].some(v => String(v || '').toLowerCase().includes(keyword)))
      return ok(data.map(x => ({ ...x, statusText: labels[x.status] || x.status })))
    }
    if (event.action === 'detail') {
      const item = (await db.collection('devices').doc(event.id).get()).data
      if (!item || (item.status === 'DISABLED' && user.role !== 'ADMIN')) return fail('设备不存在')
      return ok({ ...item, statusText: labels[item.status] || item.status })
    }
    return fail('未知操作')
  } catch (error) { console.error(error); return fail('设备服务异常') }
}
