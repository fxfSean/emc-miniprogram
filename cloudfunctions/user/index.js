const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const ok = data => ({ ok: true, data })
const fail = message => ({ ok: false, message })
exports.main = async event => {
  const openid = cloud.getWXContext().OPENID
  try {
    if (!openid) return fail('无法获取微信身份')
    if (event.action === 'session') {
      const result = await db.collection('users').where({ openid }).limit(1).get()
      return ok(result.data[0] || null)
    }
    if (event.action === 'register') {
      const name = String(event.name || '').trim()
      const studentNo = String(event.studentNo || '').trim()
      const advisor = String(event.advisor || '').trim()
      const phone = String(event.phone || '').trim()
      if (!name || !studentNo || !advisor) return fail('请填写必填信息')
      if (phone && !/^1\d{10}$/.test(phone)) return fail('手机号格式不正确')
      const invite = await db.collection('settings').doc('reservation').get().catch(() => ({ data: {} }))
      if (invite.data.inviteCode && event.inviteCode !== invite.data.inviteCode) return fail('邀请码不正确')
      const existing = await db.collection('users').where({ openid }).limit(1).get()
      if (existing.data[0] && existing.data[0].status === 'DISABLED') return fail('账号已被禁用，请联系管理员')
      const now = db.serverDate()
      const data = { openid, name, studentNo, advisor, phone, status: 'PENDING', reviewNote: '', reviewVersion: Math.max(0, Number((existing.data[0] || {}).reviewVersion) || 0), updatedAt: now }
      if (existing.data.length) await db.collection('users').doc(existing.data[0]._id).update({ data })
      else await db.collection('users').add({ data: { ...data, role: 'USER', createdAt: now } })
      return ok(true)
    }
    if (event.action === 'updateProfile') {
      const existing = await db.collection('users').where({ openid }).limit(1).get()
      const current = existing.data[0]
      if (!current) return fail('用户资料不存在')
      if (current.status !== 'APPROVED') return fail('当前资料状态不可修改')
      const name = String(event.name || '').trim()
      const studentNo = String(event.studentNo || '').trim()
      const advisor = String(event.advisor || '').trim()
      const phone = String(event.phone || '').trim()
      if (!name || !studentNo || !advisor) return fail('请填写必填信息')
      if (name.length > 30 || studentNo.length > 40 || advisor.length > 30) return fail('个人信息内容过长')
      if (phone && !/^1\d{10}$/.test(phone)) return fail('手机号格式不正确')
      const requiresReview = name !== current.name || studentNo !== current.studentNo || advisor !== current.advisor
      const data = { name, studentNo, advisor, phone, updatedAt: db.serverDate() }
      if (requiresReview) Object.assign(data, { status: 'PENDING', reviewNote: '', reviewedBy: db.command.remove(), reviewedAt: db.command.remove() })
      await db.collection('users').doc(current._id).update({ data })
      return ok({ requiresReview })
    }
    return fail('未知操作')
  } catch (error) { console.error(error); return fail('用户服务异常') }
}
