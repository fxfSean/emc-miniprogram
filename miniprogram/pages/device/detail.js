const { call } = require('../../utils/cloud')
Page({
  data: { device: null },
  onLoad(query) { this.id = query.id },
  async onShow() { this.setData({ device: await call('device', 'detail', { id: this.id }) }) },
  reserve() { wx.navigateTo({ url: `/pages/reservation/create?deviceId=${this.id}` }) },
  onShareAppMessage() {
    const name = this.data.device ? this.data.device.name : '实验室设备'
    return { title: `${name} | EMC 智造实验室`, path: `/pages/device/detail?id=${this.id}` }
  },
  onShareTimeline() {
    const name = this.data.device ? this.data.device.name : '实验室设备'
    return { title: `${name} | EMC 智造实验室`, query: `id=${this.id}` }
  }
})
