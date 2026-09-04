const { call } = require('../../utils/cloud')

Page({
  data: { devices: [], loading: false },
  async onShow() { await this.load() },
  async onPullDownRefresh() {
    try { await this.load() } finally { wx.stopPullDownRefresh() }
  },
  async load() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const devices = await call('device', 'list', { includeDisabled: true })
      this.setData({ devices })
    } finally {
      this.setData({ loading: false })
    }
  },
  add() {
    wx.navigateTo({ url: '/pages/admin/device-edit' })
  },
  edit(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/admin/device-edit?id=${encodeURIComponent(id)}` })
  }
})
