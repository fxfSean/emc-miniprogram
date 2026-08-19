const { call } = require('../../utils/cloud')
Page({
  data: { device: null },
  onLoad(query) { this.id = query.id },
  async onShow() { this.setData({ device: await call('device', 'detail', { id: this.id }) }) },
  reserve() { wx.navigateTo({ url: `/pages/reservation/create?deviceId=${this.id}` }) }
})
