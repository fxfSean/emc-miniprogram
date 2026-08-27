const { call } = require('./cloud')

function requestSubscribe(ids) {
  return new Promise((resolve, reject) => {
    wx.requestSubscribeMessage({ tmplIds: ids, success: resolve, fail: reject })
  })
}

function uniqueTemplateIds(ids) {
  return [...new Set((ids || []).map(id => String(id || '').trim()).filter(Boolean))].slice(0, 3)
}

async function loadNotificationTemplateIds(keys) {
  const result = await call('notification', 'subscriptionTemplates')
  const wanted = new Set(keys || [])
  return uniqueTemplateIds((result.templates || []).filter(item => wanted.has(item.key)).map(item => item.templateId))
}

async function requestNotificationTemplates(ids) {
  const templateIds = uniqueTemplateIds(ids)
  if (!templateIds.length) return { status: 'NOT_CONFIGURED', results: {} }
  try {
    const response = await requestSubscribe(templateIds)
    const results = {}
    templateIds.forEach(id => { if (['accept', 'reject', 'ban'].includes(response[id])) results[id] = response[id] })
    const values = Object.values(results)
    if (values.includes('accept')) return { status: 'ACCEPTED', results }
    if (values.includes('ban')) return { status: 'BANNED', results }
    if (values.includes('reject')) return { status: 'REJECTED', results }
    return { status: 'CANCELLED', results }
  } catch (error) {
    const message = String(error.errMsg || error.message || '订阅授权调用失败')
    console.warn('request subscribe message failed', { message })
    return { status: 'FAILED', results: {}, message }
  }
}

function subscriptionOutcomeMessage(outcome) {
  const status = (outcome || {}).status
  if (status === 'ACCEPTED') return '微信提醒已开启'
  if (status === 'BANNED') return '提醒权限已关闭，请在小程序设置中开启'
  if (status === 'REJECTED') return '你已拒绝微信提醒授权'
  if (status === 'NOT_CONFIGURED') return '管理员尚未配置模板'
  if (status === 'FAILED') return '微信授权调用失败，请重新点击'
  return '未开启微信提醒'
}

async function saveSubscriptionResults(results) {
  if (!results || !Object.keys(results).length) return
  try { await call('notification', 'saveSubscriptionResult', { results }) } catch (error) { console.warn('save subscription result failed') }
}

module.exports = { loadNotificationTemplateIds, requestNotificationTemplates, saveSubscriptionResults, subscriptionOutcomeMessage }
