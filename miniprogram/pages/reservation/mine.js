const { call } = require('../../utils/cloud')
const { requireApproved } = require('../../utils/auth')

Page({
  data: {
    reservations: [],
    tabs: [
      { value: 'WAITING', label: '待使用' },
      { value: 'IN_USE', label: '使用中' },
      { value: 'ENDED', label: '已结束' },
      { value: 'CANCELLED', label: '已取消' }
    ],
    tab: 'WAITING',
    activeTabLabel: '待使用',
    actingId: '',
    actingAction: ''
  },

  async onShow() {
    const user = await requireApproved()
    if (user) await this.load()
  },

  async onPullDownRefresh() {
    await this.load()
    wx.stopPullDownRefresh()
  },

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
    const confirmed = await new Promise(resolve => wx.showModal({ title: '取消预约', content: '确定取消该预约吗？', success: result => resolve(result.confirm) }))
    if (!confirmed) return
    await call('reservation', 'cancel', { id: e.currentTarget.dataset.id })
    await this.load()
  },

  locate() {
    return new Promise((resolve, reject) => {
      wx.getLocation({ type: 'gcj02', isHighAccuracy: true, highAccuracyExpireTime: 5000, success: resolve, fail: reject })
    })
  },

  async checkIn(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.actingId) return
    this.setData({ actingId: id, actingAction: 'CHECK_IN' })
    try {
      const location = await this.locate()
      await call('reservation', 'checkIn', { id, location: { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy } })
      wx.showToast({ title: '签到成功' })
      this.setData({ tab: 'IN_USE', activeTabLabel: '使用中' })
      await this.load()
    } catch (error) {
      const message = String(error.errMsg || error.message || '')
      if (message.includes('getLocation') || message.includes('auth deny')) {
        wx.showModal({
          title: '需要定位权限',
          content: '签到需要确认您已到达实验室，请在设置中允许使用位置信息。',
          confirmText: '前往设置',
          success: result => { if (result.confirm) wx.openSetting() }
        })
      }
    } finally {
      this.setData({ actingId: '', actingAction: '' })
    }
  },

  async checkOut(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.actingId) return
    const confirmed = await new Promise(resolve => wx.showModal({ title: '确认签退？', content: '签退后将记录本次实际使用时长。', confirmText: '确认签退', success: result => resolve(result.confirm) }))
    if (!confirmed) return
    this.setData({ actingId: id, actingAction: 'CHECK_OUT' })
    try {
      await call('reservation', 'checkOut', { id })
      wx.showToast({ title: '签退成功' })
      this.setData({ tab: 'ENDED', activeTabLabel: '已结束' })
      await this.load()
    } finally {
      this.setData({ actingId: '', actingAction: '' })
    }
  }
})
