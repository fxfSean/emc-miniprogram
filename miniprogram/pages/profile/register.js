const { call } = require('../../utils/cloud')
const { loadNotificationTemplateIds, requestNotificationTemplates, saveSubscriptionResults } = require('../../utils/notifications')
Page({
  data: { name: '', studentNo: '', advisor: '', phone: '', inviteCode: '', submitting: false },
  onLoad() { this.prepareSubscriptionTemplates() },
  async prepareSubscriptionTemplates() {
    try { this.subscriptionTemplateIds = await loadNotificationTemplateIds(['review']) }
    catch (error) { this.subscriptionTemplateIds = [] }
  },
  input(e) { this.setData({ [e.currentTarget.dataset.key]: e.detail.value.trim() }) },
  async submit() {
    const { name, studentNo, advisor, phone, inviteCode } = this.data
    if (!name || !studentNo || !advisor) return wx.showToast({ title: '请填写必填信息', icon: 'none' })
    if (phone && !/^1\d{10}$/.test(phone)) return wx.showToast({ title: '手机号格式不正确', icon: 'none' })
    this.setData({ submitting: true })
    try {
      const subscriptionOutcome = await requestNotificationTemplates(this.subscriptionTemplateIds)
      await call('user', 'register', { name, studentNo, advisor, phone, inviteCode })
      await saveSubscriptionResults(subscriptionOutcome.results)
      getApp().clearSession()
      wx.redirectTo({ url: '/pages/profile/status' })
    } finally { this.setData({ submitting: false }) }
  }
})
