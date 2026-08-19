const { call } = require('../../utils/cloud')
const { requireApproved } = require('../../utils/auth')
Page({
  data: { user: null, reservations: [], tab: 'UPCOMING' },
  async onShow() { const user = await requireApproved(); if (user) { this.setData({ user }); await this.load() } },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh() },
  async load() { this.setData({ reservations: await call('reservation', 'mine', { scope: this.data.tab }) }) },
  async tab(e) { this.setData({ tab: e.currentTarget.dataset.tab }); await this.load() },
  async cancel(e) {
    const confirmed = await new Promise(resolve => wx.showModal({ title: '取消预约', content: '确定取消该预约吗？', success: r => resolve(r.confirm) }))
    if (!confirmed) return
    await call('reservation', 'cancel', { id: e.currentTarget.dataset.id }); await this.load()
  },
  admin() { wx.navigateTo({ url: '/pages/admin/index' }) }
})
