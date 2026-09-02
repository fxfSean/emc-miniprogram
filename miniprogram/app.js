const { call } = require('./utils/cloud')

App({
  globalData: { user: null, envId: 'emc-lab-dev-d6gtpq5dh51b806c3', appVersion: '2.2.0' }, // 开发
  // globalData: { user: null, envId: 'emc-lab-dev-d4g8yb8vs1adca97a' }, // 线上
  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({ title: '版本过低', content: '请升级微信后再使用本小程序', showCancel: false })
      return
    }
    wx.cloud.init({ env: this.globalData.envId || undefined, traceUser: true })
  },
  async loadSession(force = false) {
    if (this.globalData.user && !force) return this.globalData.user
    const user = await call('user', 'session')
    this.globalData.user = user
    return user
  },
  clearSession() { this.globalData.user = null }
})
