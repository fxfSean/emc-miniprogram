const ENVIRONMENT_LABELS = {
  release: '正式版',
  trial: '体验版',
  develop: '开发版'
}

Page({
  data: {
    version: '1.0.0',
    environment: '开发版'
  },

  onLoad() {
    const app = getApp()
    const fallbackVersion = app.globalData.appVersion || '1.0.0'

    try {
      const accountInfo = wx.getAccountInfoSync()
      const miniProgram = accountInfo.miniProgram || {}
      this.setData({
        version: miniProgram.version || fallbackVersion,
        environment: ENVIRONMENT_LABELS[miniProgram.envVersion] || '开发版'
      })
    } catch (error) {
      this.setData({ version: fallbackVersion })
    }
  },

  openPrivacyContract() {
    if (typeof wx.openPrivacyContract !== 'function') {
      wx.showModal({
        title: '暂时无法打开',
        content: '当前微信版本不支持直接查看隐私保护指引，请升级微信后重试。',
        showCancel: false
      })
      return
    }

    wx.openPrivacyContract({
      fail: () => {
        wx.showModal({
          title: '暂时无法打开',
          content: '隐私保护指引暂时不可用，请稍后重试，或通过小程序右上角菜单查看。',
          showCancel: false
        })
      }
    })
  }
})
