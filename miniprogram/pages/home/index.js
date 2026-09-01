const { call } = require('../../utils/cloud')
const { requireApproved } = require('../../utils/auth')
Page({
  data: { keyword: '', devices: [], loading: true },
  async onShow() { if (await requireApproved()) await this.loadDevices() },
  async onPullDownRefresh() { await this.loadDevices(); wx.stopPullDownRefresh() },
  onInput(e) { this.setData({ keyword: e.detail.value }) },
  async loadDevices() {
    this.setData({ loading: true })
    try { this.setData({ devices: await call('device', 'list', { keyword: this.data.keyword }) }) }
    finally { this.setData({ loading: false }) }
  },
  search() { this.loadDevices() },
  open(e) { wx.navigateTo({ url: `/pages/device/detail?id=${e.currentTarget.dataset.id}` }) },
  onShareAppMessage() {
    return { title: 'EMC 智造实验室设备预约', path: '/pages/home/index' }
  },
  onShareTimeline() {
    return { title: 'EMC 智造实验室设备预约' }
  }
})
