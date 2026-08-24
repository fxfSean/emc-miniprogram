const { call } = require('../../utils/cloud')
Page({
  data: { summary: {} },
  async onShow() { this.setData({ summary: await call('admin', 'summary') }) },
  users() { wx.navigateTo({ url: '/pages/admin/users' }) },
  devices() { wx.navigateTo({ url: '/pages/admin/devices' }) },
  reservations() { wx.navigateTo({ url: '/pages/admin/reservations' }) },
  notifications() { wx.navigateTo({ url: '/pages/admin/announcements' }) }
})
