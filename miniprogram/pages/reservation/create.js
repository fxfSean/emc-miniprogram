const { call } = require('../../utils/cloud')
const pad = n => String(n).padStart(2, '0')
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
Page({
  data: { device: null, date: today(), startTime: '09:00', endTime: '10:00', reason: '', occupied: [], submitting: false },
  onLoad(query) { this.deviceId = query.deviceId },
  async onShow() { await this.load() },
  async load() {
    const [device, occupied] = await Promise.all([
      call('device', 'detail', { id: this.deviceId }),
      call('reservation', 'availability', { deviceId: this.deviceId, date: this.data.date })
    ])
    this.setData({ device, occupied })
  },
  async dateChange(e) { this.setData({ date: e.detail.value }); await this.load() },
  startChange(e) { this.setData({ startTime: e.detail.value }) },
  endChange(e) { this.setData({ endTime: e.detail.value }) },
  reasonInput(e) { this.setData({ reason: e.detail.value }) },
  async submit() {
    const { date, startTime, endTime, reason } = this.data
    if (startTime >= endTime) return wx.showToast({ title: '结束时间必须晚于开始时间', icon: 'none' })
    if (!reason.trim()) return wx.showToast({ title: '请填写实验内容', icon: 'none' })
    this.setData({ submitting: true })
    try {
      await call('reservation', 'create', { deviceId: this.deviceId, date, startTime, endTime, reason: reason.trim() })
      wx.showToast({ title: '预约成功' })
      setTimeout(() => wx.switchTab({ url: '/pages/mine/index' }), 600)
    } finally { this.setData({ submitting: false }) }
  }
})
