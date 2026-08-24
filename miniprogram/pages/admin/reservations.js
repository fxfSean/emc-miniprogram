const { call } = require('../../utils/cloud')
const pad = value => String(value).padStart(2, '0')
const formatDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const today = () => formatDate(new Date())
const dateRange = value => [Date.parse(`${value}T00:00:00+08:00`), Date.parse(`${value}T00:00:00+08:00`) + 86400000]

Page({
  data: {
    view: 'CALENDAR', views: [{ key: 'CALENDAR', label: '日历' }, { key: 'LIST', label: '列表' }],
    devices: [], deviceNames: ['全部设备'], deviceIndex: 0, deviceId: '',
    monthTitle: '', weekdays: ['日', '一', '二', '三', '四', '五', '六'], calendarDays: [], counts: {},
    selectedDate: today(), items: [], total: 0, page: 1, hasMore: false, loading: false, summary: { checkedInCount: 0, completedCount: 0, actualDurationText: '0 分钟' },
    detail: null, detailVisible: false,
    cancelVisible: false, cancelReason: '', cancelReasonCount: 0, cancelling: false,
    overrideVisible: false, overrideType: '', overrideReason: '', overrideReasonCount: 0, overriding: false
  },
  async onLoad() {
    const now = new Date(); this.year = now.getFullYear(); this.month = now.getMonth() + 1
    await this.loadDevices(); await this.refresh(); this.loaded = true
  },
  onShow() { if (this.loaded) this.refresh() },
  async onPullDownRefresh() { try { await this.refresh() } finally { wx.stopPullDownRefresh() } },
  async loadDevices() {
    const devices = await call('device', 'list', { includeDisabled: true })
    this.setData({ devices, deviceNames: ['全部设备', ...devices.map(item => `${item.deviceNo} · ${item.name}`)] })
  },
  switchView(e) { this.setData({ view: e.currentTarget.dataset.key }); this.loadList(true) },
  async deviceChange(e) {
    const deviceIndex = Number(e.detail.value), device = this.data.devices[deviceIndex - 1]
    this.setData({ deviceIndex, deviceId: device ? device._id : '' }); await this.refresh()
  },
  async dateChange(e) {
    const value = e.detail.value, date = new Date(`${value}T12:00:00+08:00`)
    this.year = date.getFullYear(); this.month = date.getMonth() + 1
    this.setData({ selectedDate: value }); await this.refresh()
  },
  async changeMonth(e) {
    const next = new Date(this.year, this.month - 1 + Number(e.currentTarget.dataset.delta), 1)
    this.year = next.getFullYear(); this.month = next.getMonth() + 1
    this.setData({ selectedDate: `${this.year}-${pad(this.month)}-01` }); await this.refresh()
  },
  async selectDay(e) {
    const value = e.currentTarget.dataset.value
    if (!value) return
    this.setData({ selectedDate: value }); this.buildCalendar(this.data.counts); await this.loadList(true)
  },
  buildCalendar(counts) {
    const first = new Date(this.year, this.month - 1, 1).getDay(), total = new Date(this.year, this.month, 0).getDate(), days = []
    for (let index = 0; index < first; index += 1) days.push({ key: `s${index}`, empty: true })
    for (let day = 1; day <= total; day += 1) {
      const value = `${this.year}-${pad(this.month)}-${pad(day)}`
      days.push({ key: value, value, day, count: counts[value] || 0, selected: value === this.data.selectedDate, today: value === today() })
    }
    while (days.length % 7) days.push({ key: `e${days.length}`, empty: true })
    this.setData({ monthTitle: `${this.year} 年 ${this.month} 月`, calendarDays: days })
  },
  async refresh() {
    this.setData({ loading: true })
    try {
      const month = `${this.year}-${pad(this.month)}`
      const calendar = await call('admin', 'reservationCalendar', { month, deviceId: this.data.deviceId })
      this.setData({ counts: calendar.counts || {} }); this.buildCalendar(calendar.counts || {})
      await this.loadList(true)
    } finally { this.setData({ loading: false }) }
  },
  async loadList(reset) {
    if (this.listLoading) return
    this.listLoading = true
    try {
      const page = reset ? 1 : this.data.page + 1, [startAt, endAt] = dateRange(this.data.selectedDate)
      const result = await call('admin', 'listReservations', { startAt, endAt, deviceId: this.data.deviceId, page, pageSize: 20 })
      this.setData({ items: reset ? result.items : this.data.items.concat(result.items), total: result.total, page, hasMore: result.hasMore, summary: result.summary || this.data.summary })
    } finally { this.listLoading = false }
  },
  loadMore() { if (this.data.hasMore) this.loadList(false) },
  noop() {},
  async openDetail(e) { const detail = await call('admin', 'reservationDetail', { id: e.currentTarget.dataset.id }); this.setData({ detail, detailVisible: true }) },
  closeDetail() {
    if (this.data.cancelling) return
    this.setData({ detailVisible: false, detail: null, cancelVisible: false, cancelReason: '', cancelReasonCount: 0, overrideVisible: false, overrideType: '', overrideReason: '', overrideReasonCount: 0 })
  },
  cancel() {
    const detail = this.data.detail
    if (!detail || !detail.canCancel) return
    this.setData({ cancelVisible: true, cancelReason: '', cancelReasonCount: 0 })
  },
  cancelReasonInput(e) {
    const cancelReason = e.detail.value
    this.setData({ cancelReason, cancelReasonCount: cancelReason.length })
  },
  closeCancel() {
    if (this.data.cancelling) return
    this.setData({ cancelVisible: false, cancelReason: '', cancelReasonCount: 0 })
  },
  async confirmCancel() {
    const { detail, cancelReason, cancelling } = this.data
    if (!detail || cancelling) return
    const reason = String(cancelReason || '').trim()
    if (!reason) return wx.showToast({ title: '请填写取消原因', icon: 'none' })
    this.setData({ cancelling: true })
    try {
      await call('reservation', 'adminCancel', { id: detail._id, reason })
      wx.showToast({ title: '预约已取消' })
      this.setData({ detailVisible: false, detail: null, cancelVisible: false, cancelReason: '', cancelReasonCount: 0 })
      await this.refresh()
    } finally {
      this.setData({ cancelling: false })
    }
  },
  openOverride(e) {
    const overrideType = e.currentTarget.dataset.type
    if (!['CHECK_IN', 'CHECK_OUT'].includes(overrideType)) return
    this.setData({ overrideVisible: true, overrideType, overrideReason: '', overrideReasonCount: 0 })
  },
  overrideReasonInput(e) {
    const overrideReason = e.detail.value
    this.setData({ overrideReason, overrideReasonCount: overrideReason.length })
  },
  closeOverride() {
    if (this.data.overriding) return
    this.setData({ overrideVisible: false, overrideType: '', overrideReason: '', overrideReasonCount: 0 })
  },
  async confirmOverride() {
    const { detail, overrideType, overrideReason, overriding } = this.data
    if (!detail || overriding) return
    const reason = String(overrideReason || '').trim()
    if (!reason) return wx.showToast({ title: '请填写操作原因', icon: 'none' })
    const action = overrideType === 'CHECK_IN' ? 'adminCheckIn' : 'adminCheckOut'
    this.setData({ overriding: true })
    try {
      await call('reservation', action, { id: detail._id, reason })
      wx.showToast({ title: overrideType === 'CHECK_IN' ? '代签到成功' : '代签退成功' })
      this.setData({ overrideVisible: false, overrideType: '', overrideReason: '', overrideReasonCount: 0, detailVisible: false, detail: null })
      await this.refresh()
    } finally {
      this.setData({ overriding: false })
    }
  },
  create() { wx.navigateTo({ url: '/pages/admin/reservation-create' }) },
  blocks() { wx.navigateTo({ url: '/pages/admin/device-blocks' }) },
  rules() { wx.navigateTo({ url: '/pages/admin/reservation-rules' }) }
})
