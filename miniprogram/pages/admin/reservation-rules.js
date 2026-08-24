const { call } = require('../../utils/cloud')
Page({
  data: {
    form: { maxDailyMinutes: 240, maxActiveReservations: 3, maxAdvanceDays: 7, cancelDeadlineMinutes: 30, checkInEarlyMinutes: 30, checkInRadiusMeters: 100, maxLocationAccuracyMeters: 150, checkInSite: { name: '主实验室', latitude: null, longitude: null } },
    saving: false,
    locating: false,
    siteConfigured: false
  },
  async onLoad() {
    const form = await call('admin', 'getReservationSettings')
    const site = form.checkInSite || {}
    this.setData({ form, siteConfigured: site.latitude !== null && site.latitude !== '' && site.longitude !== null && site.longitude !== '' && Number.isFinite(Number(site.latitude)) && Number.isFinite(Number(site.longitude)) })
  },
  input(e) { this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value }) },
  locate() {
    if (this.data.locating) return
    this.setData({ locating: true })
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      highAccuracyExpireTime: 5000,
      success: location => this.setData({ 'form.checkInSite.latitude': location.latitude, 'form.checkInSite.longitude': location.longitude, siteConfigured: true }),
      fail: () => wx.showModal({ title: '无法获取位置', content: '请允许小程序使用位置信息，并在实验室现场重新设置。', showCancel: false }),
      complete: () => this.setData({ locating: false })
    })
  },
  async save() {
    const source = this.data.form
    const values = {
      maxDailyMinutes: Number(source.maxDailyMinutes), maxActiveReservations: Number(source.maxActiveReservations), maxAdvanceDays: Number(source.maxAdvanceDays), cancelDeadlineMinutes: Number(source.cancelDeadlineMinutes),
      checkInEarlyMinutes: Number(source.checkInEarlyMinutes), checkInRadiusMeters: Number(source.checkInRadiusMeters), maxLocationAccuracyMeters: Number(source.maxLocationAccuracyMeters),
      checkInSite: { name: String(source.checkInSite.name || '').trim(), latitude: source.checkInSite.latitude, longitude: source.checkInSite.longitude }
    }
    this.setData({ saving: true })
    try { const form = await call('admin', 'saveReservationSettings', values); this.setData({ form, siteConfigured: true }); wx.showToast({ title: '规则已生效' }) }
    finally { this.setData({ saving: false }) }
  }
})
