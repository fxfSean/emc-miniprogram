const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database(), _ = db.command
const labels = { AVAILABLE: '可预约', MAINTENANCE: '维护中', DISABLED: '已停用' }
const ok = data => ({ ok: true, data }), fail = message => ({ ok: false, message })
async function currentUser() { const openid = cloud.getWXContext().OPENID; if (!openid) return null; const r = await db.collection('users').where({ openid }).limit(1).get(); return r.data[0] }
function outputDevice(item, includePrivateLocation) {
  const site = item.checkInSite || {}
  const latitude = site.latitude === null || site.latitude === undefined || site.latitude === '' ? NaN : Number(site.latitude)
  const longitude = site.longitude === null || site.longitude === undefined || site.longitude === '' ? NaN : Number(site.longitude)
  const summary = {
    checkInPlace: { name: String(site.name || ''), address: String(site.address || '') },
    checkInConfigured: Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180,
    statusText: labels[item.status] || item.status
  }
  if (includePrivateLocation) return { ...item, ...summary }
  const { checkInSite, locationUpdatedBy, locationUpdatedAt, locationVersion, ...safe } = item
  return { ...safe, ...summary }
}
exports.main = async event => {
  try {
    const user = await currentUser()
    if (!user || user.status !== 'APPROVED') return fail('账号尚未通过审核')
    if (event.action === 'list') {
      let query = db.collection('devices')
      const adminView = Boolean(event.includeDisabled && user.role === 'ADMIN')
      if (!adminView) query = query.where({ status: _.neq('DISABLED') })
      let data = (await query.orderBy('deviceNo', 'asc').limit(100).get()).data
      const keyword = String(event.keyword || '').trim().toLowerCase()
      const keywords = Array.isArray(event.keywords) ? event.keywords.map(value => String(value || '').trim().toLowerCase()).filter(Boolean).slice(0, 10) : []
      const searchTerms = keywords.length ? keywords : (keyword ? [keyword] : [])
      if (searchTerms.length) data = data.filter(x => searchTerms.some(term => [x.name, x.deviceNo, x.model, x.location].some(v => String(v || '').toLowerCase().includes(term))))
      return ok(data.map(item => outputDevice(item, adminView)))
    }
    if (event.action === 'detail') {
      const item = (await db.collection('devices').doc(event.id).get()).data
      if (!item || (item.status === 'DISABLED' && user.role !== 'ADMIN')) return fail('设备不存在')
      return ok(outputDevice(item, user.role === 'ADMIN'))
    }
    return fail('未知操作')
  } catch (error) { console.error(error); return fail('设备服务异常') }
}
