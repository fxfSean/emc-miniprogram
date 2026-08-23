const { call } = require('../../utils/cloud')
const { requireApproved } = require('../../utils/auth')
Page({
  data: {
    user: null,
    reservations: [],
    tabs: [
      { value: 'WAITING', label: '待使用' },
      { value: 'IN_USE', label: '使用中' },
      { value: 'ENDED', label: '已结束' },
      { value: 'CANCELLED', label: '已取消' }
    ],
    tab: 'WAITING',
    activeTabLabel: '待使用'
  },
  async onShow() { const user = await requireApproved(); if (user) { this.setData({ user }); await this.load() } },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh() },
  async load() {
    const requestId = (this.reservationRequestId || 0) + 1
    this.reservationRequestId = requestId
    const scope = this.data.tab
    const reservations = await call('reservation', 'mine', { scope })
    if (requestId === this.reservationRequestId && scope === this.data.tab) this.setData({ reservations })
  },
  async tab(e) {
    const { tab, label } = e.currentTarget.dataset
    if (tab === this.data.tab) return
    this.setData({ tab, activeTabLabel: label })
    await this.load()
  },
  async cancel(e) {
    const confirmed = await new Promise(resolve => wx.showModal({ title: '取消预约', content: '确定取消该预约吗？', success: r => resolve(r.confirm) }))
    if (!confirmed) return
    await call('reservation', 'cancel', { id: e.currentTarget.dataset.id }); await this.load()
  },
  editProfile() { wx.navigateTo({ url: '/pages/profile/edit' }) },
  admin() { wx.navigateTo({ url: '/pages/admin/index' }) }
})
