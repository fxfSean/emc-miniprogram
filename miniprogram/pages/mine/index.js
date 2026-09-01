const { call } = require('../../utils/cloud')
const { requireApproved } = require('../../utils/auth')

Page({
  data: {
    user: null,
    profileInitial: '',
    roleLabel: '实验室成员',
    notification: { unreadCount: 0, latestTitle: '暂无新消息', wechatConfigured: false }
  },

  async onShow() {
    const user = await requireApproved()
    if (!user) return
    this.setData({
      user,
      profileInitial: (user.name || '用户').slice(0, 1),
      roleLabel: user.role === 'ADMIN' ? '实验室管理员' : '实验室成员'
    })
    await this.loadNotification()
  },

  async onPullDownRefresh() {
    await this.loadNotification()
    wx.stopPullDownRefresh()
  },

  async loadNotification() {
    try { this.setData({ notification: await call('notification', 'summary') }) } catch (error) { console.warn('notification summary unavailable') }
  },

  reservations() { wx.navigateTo({ url: '/pages/reservation/mine' }) },
  editProfile() { wx.navigateTo({ url: '/pages/profile/edit' }) },
  messages() { wx.navigateTo({ url: '/pages/notifications/index' }) },
  about() { wx.navigateTo({ url: '/pages/about/index' }) },
  admin() { wx.navigateTo({ url: '/pages/admin/index' }) }
})
