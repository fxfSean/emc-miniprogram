async function call(name, action, data = {}) {
  try {
    const response = await wx.cloud.callFunction({ name, data: { action, ...data } })
    const result = response.result || {}
    if (!result.ok) throw new Error(result.message || '服务暂不可用')
    return result.data
  } catch (error) {
    const message = error.message || '网络异常，请稍后重试'
    wx.showToast({ title: message, icon: 'none' })
    throw error
  }
}
module.exports = { call }
