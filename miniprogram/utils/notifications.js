const { call } = require('./cloud')

function requestSubscribe(ids) {
  return new Promise((resolve, reject) => {
    wx.requestSubscribeMessage({ tmplIds: ids, success: resolve, fail: reject })
  })
}

async function requestNotificationTemplates(keys) {
  try {
    const result = await call('notification', 'subscriptionTemplates')
    const wanted = new Set(keys || [])
    const ids = (result.templates || []).filter(item => wanted.has(item.key)).map(item => item.templateId).filter(Boolean).slice(0, 3)
    if (!ids.length) return {}
    const response = await requestSubscribe(ids)
    const results = {}
    ids.forEach(id => { if (['accept', 'reject', 'ban'].includes(response[id])) results[id] = response[id] })
    return results
  } catch (error) {
    return {}
  }
}

async function saveSubscriptionResults(results) {
  if (!results || !Object.keys(results).length) return
  try { await call('notification', 'saveSubscriptionResult', { results }) } catch (error) { console.warn('save subscription result failed') }
}

module.exports = { requestNotificationTemplates, saveSubscriptionResults }
