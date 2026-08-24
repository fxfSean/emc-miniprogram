const { call } = require('../../utils/cloud')
const { requestNotificationTemplates, saveSubscriptionResults } = require('../../utils/notifications')
Page({
  data: { name: '', studentNo: '', advisor: '', phone: '', inviteCode: '', submitting: false },
  input(e) { this.setData({ [e.currentTarget.dataset.key]: e.detail.value.trim() }) },
  async submit() {
    const { name, studentNo, advisor, phone, inviteCode } = this.data
    if (!name || !studentNo || !advisor) return wx.showToast({ title: '请填写必填信息', icon: 'none' })
    if (phone && !/^1\d{10}$/.test(phone)) return wx.showToast({ title: '手机号格式不正确', icon: 'none' })
    this.setData({ submitting: true })
    try {
      const subscriptionResults = await requestNotificationTemplates(['review'])
      await call('user', 'register', { name, studentNo, advisor, phone, inviteCode })
      await saveSubscriptionResults(subscriptionResults)
      getApp().clearSession()
      wx.redirectTo({ url: '/pages/profile/status' })
    } finally { this.setData({ submitting: false }) }
  }
})
