const { call } = require('../../utils/cloud')
const DEFAULT_RADIUS = 100
const blankSite = () => ({ name: '', address: '', latitude: null, longitude: null, radiusMeters: DEFAULT_RADIUS })
const blank = () => ({ _id: '', deviceNo: '', name: '', model: '', manufacturer: '', location: '', description: '', status: 'AVAILABLE', checkInSite: blankSite() })
const hasCoordinate = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
const configured = site => Boolean(site) && hasCoordinate(site.latitude) && Number(site.latitude) >= -90 && Number(site.latitude) <= 90 && hasCoordinate(site.longitude) && Number(site.longitude) >= -180 && Number(site.longitude) <= 180
const normalizeSite = (site, fallbackRadius = DEFAULT_RADIUS) => ({
  name: String((site || {}).name || ''),
  address: String((site || {}).address || ''),
  latitude: configured(site) ? Number(site.latitude) : null,
  longitude: configured(site) ? Number(site.longitude) : null,
  radiusMeters: Number((site || {}).radiusMeters) || Number(fallbackRadius) || DEFAULT_RADIUS
})

Page({
  data: {
    form: blank(), statuses: ['AVAILABLE', 'MAINTENANCE', 'DISABLED'], statusNames: ['可预约', '维护中', '已停用'], statusIndex: 0,
    loading: true, processing: '', choosingLocation: false, siteConfigured: false, inheritedSite: false,
    mapLatitude: 0, mapLongitude: 0, mapMarkers: [], mapCircles: []
  },
  async onLoad(options) {
    this.deviceId = String((options || {}).id || '').trim()
    wx.setNavigationBarTitle({ title: this.deviceId ? '编辑设备' : '新增设备' })
    if (!this.deviceId) {
      this.setData({ loading: false })
      return
    }
    await this.loadDevice()
  },
  async loadDevice() {
    try {
      const [devices, rules] = await Promise.all([
        call('device', 'list', { includeDisabled: true }),
        call('admin', 'getReservationSettings')
      ])
      const device = devices.find(item => item._id === this.deviceId)
      if (!device) {
        wx.showToast({ title: '设备不存在', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 800)
        return
      }
      const legacySite = normalizeSite({ ...(rules.checkInSite || {}), radiusMeters: rules.checkInRadiusMeters })
      const deviceSite = normalizeSite(device.checkInSite)
      const inheritedSite = !configured(deviceSite) && configured(legacySite)
      const checkInSite = configured(deviceSite) ? deviceSite : (inheritedSite ? { ...legacySite } : blankSite())
      const form = { ...device, checkInSite }
      const statusIndex = this.data.statuses.indexOf(form.status)
      this.setData({ form, statusIndex: statusIndex < 0 ? 0 : statusIndex, inheritedSite, ...this.mapData(checkInSite) })
    } finally {
      this.setData({ loading: false })
    }
  },
  input(e) { this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value }) },
  status(e) {
    const statusIndex = Number(e.detail.value)
    this.setData({ statusIndex, 'form.status': this.data.statuses[statusIndex] })
  },
  mapData(site) {
    if (!configured(site)) return { siteConfigured: false, mapLatitude: 0, mapLongitude: 0, mapMarkers: [], mapCircles: [] }
    const latitude = Number(site.latitude), longitude = Number(site.longitude), radius = Number(site.radiusMeters) || DEFAULT_RADIUS
    return {
      siteConfigured: true,
      mapLatitude: latitude,
      mapLongitude: longitude,
      mapMarkers: [{ id: 1, latitude, longitude, iconPath: '/assets/tabbar/device-active.png', width: 30, height: 30 }],
      mapCircles: [{ latitude, longitude, radius, color: '#176b5b', fillColor: '#176b5b22', strokeWidth: 2 }]
    }
  },
  chooseLocation() {
    if (this.data.choosingLocation) return
    const current = this.data.form.checkInSite || blankSite()
    const options = {
      success: result => {
        const site = {
          name: String(result.name || result.address || '设备位置'),
          address: String(result.address || ''),
          latitude: Number(result.latitude),
          longitude: Number(result.longitude),
          radiusMeters: Number(current.radiusMeters) || DEFAULT_RADIUS
        }
        const updates = { 'form.checkInSite': site, inheritedSite: false, ...this.mapData(site) }
        if (!String(this.data.form.location || '').trim()) updates['form.location'] = site.name
        this.setData(updates)
      },
      fail: error => {
        const message = String(error.errMsg || error.message || '')
        const lowerMessage = message.toLowerCase()
        console.error('chooseLocation failed', error)
        if (lowerMessage.includes('cancel')) return
        const needsPlatformSetup = ['privacy agreement', 'not declared', 'requiredprivateinfos', 'api scope', '接口权限'].some(keyword => lowerMessage.includes(keyword))
        if (needsPlatformSetup) {
          wx.showModal({ title: '地图选点尚未开通', content: '请管理员在小程序管理后台的“开发管理－接口设置”中开通“选择地理位置”，并更新隐私保护指引后重新预览。', showCancel: false })
          return
        }
        if (lowerMessage.includes('auth') || lowerMessage.includes('permission denied')) {
          wx.showModal({ title: '需要位置权限', content: '地图选点需要位置权限，请在设置中允许后重试。', confirmText: '前往设置', success: result => { if (result.confirm) wx.openSetting() } })
          return
        }
        wx.showModal({ title: '地图选点失败', content: message ? `微信返回：${message.slice(0, 120)}` : '未获取到微信错误信息，请检查“选择地理位置”接口权限。', showCancel: false })
      },
      complete: () => this.setData({ choosingLocation: false })
    }
    if (configured(current)) Object.assign(options, { latitude: Number(current.latitude), longitude: Number(current.longitude) })
    this.setData({ choosingLocation: true })
    wx.chooseLocation(options)
  },
  radiusInput(e) {
    const radiusMeters = e.detail.value
    this.setData({ 'form.checkInSite.radiusMeters': radiusMeters })
    if (this.data.siteConfigured) this.setData(this.mapData({ ...this.data.form.checkInSite, radiusMeters }))
  },
  async save() {
    const { form } = this.data
    if (this.data.processing) return
    if (!form.deviceNo || !form.name) return wx.showToast({ title: '编号和名称为必填项', icon: 'none' })
    if (form.status === 'AVAILABLE' && !configured(form.checkInSite)) return wx.showToast({ title: '请先在地图中选择签到位置', icon: 'none' })
    const radiusMeters = Number((form.checkInSite || {}).radiusMeters)
    if (configured(form.checkInSite) && (!Number.isInteger(radiusMeters) || radiusMeters < 20 || radiusMeters > 2000)) return wx.showToast({ title: '签到范围须为 20–2000 米', icon: 'none' })
    this.setData({ processing: 'SAVE' })
    try {
      await call('admin', 'saveDevice', { device: { ...form, checkInSite: { ...form.checkInSite, radiusMeters } } })
      wx.showToast({ title: '设备已保存', icon: 'success' })
      wx.navigateBack()
    } finally {
      this.setData({ processing: '' })
    }
  },
  deleteDevice() {
    const { form, processing } = this.data
    if (!form._id || processing) return
    wx.showModal({
      title: '确认删除设备？',
      content: `将永久删除“${form.name}”。仅无关联预约和维护时段的设备可以删除，删除后不可恢复。`,
      confirmText: '确认删除',
      confirmColor: '#B64A43',
      success: result => { if (result.confirm) this.confirmDelete(form._id) }
    })
  },
  async confirmDelete(id) {
    if (this.data.processing) return
    this.setData({ processing: 'DELETE' })
    try {
      await call('admin', 'deleteDevice', { id })
      wx.showToast({ title: '设备已删除', icon: 'success' })
      wx.navigateBack()
    } finally {
      this.setData({ processing: '' })
    }
  }
})
