const { call } = require('../../utils/cloud')
Page({
  data: {
    form: { maxDailyMinutes: 240, maxActiveReservations: 3, maxAdvanceDays: 7, cancelDeadlineMinutes: 30, checkInEarlyMinutes: 30, maxLocationAccuracyMeters: 150 },
    saving: false
  },
  async onLoad() {
    const form = await call('admin', 'getReservationSettings')
    this.setData({ form })
  },
  input(e) { this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value }) },
  async save() {
    const source = this.data.form
    const values = {
      maxDailyMinutes: Number(source.maxDailyMinutes), maxActiveReservations: Number(source.maxActiveReservations), maxAdvanceDays: Number(source.maxAdvanceDays), cancelDeadlineMinutes: Number(source.cancelDeadlineMinutes),
      checkInEarlyMinutes: Number(source.checkInEarlyMinutes), maxLocationAccuracyMeters: Number(source.maxLocationAccuracyMeters)
    }
    this.setData({ saving: true })
    try { const form = await call('admin', 'saveReservationSettings', values); this.setData({ form }); wx.showToast({ title: '规则已生效' }) }
    finally { this.setData({ saving: false }) }
  }
})
