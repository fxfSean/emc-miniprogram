const { call } = require('../../utils/cloud')
const pad = value => String(value).padStart(2, '0')
const formatDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const today = () => formatDate(new Date())
const dateRange = value => [Date.parse(`${value}T00:00:00+08:00`), Date.parse(`${value}T00:00:00+08:00`) + 86400000]
const WEEK_TEXTS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

Page({
  data: {
    view: 'CALENDAR', views: [{ key: 'CALENDAR', label: '日历' }, { key: 'LIST', label: '列表' }],
    devices: [], deviceNames: ['全部设备'], deviceIndex: 0, deviceId: '',
    weekDays: [],
    selectedDate: today(), items: [], total: 0, page: 1, hasMore: false, loading: false, summary: { checkedInCount: 0, completedCount: 0, actualDurationText: '0 分钟' }
  },
  async onLoad() {
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
    const value = e.detail.value
    this.setData({ selectedDate: value }); await this.loadList(true)
  },
  async onSelectDate(e) {
    const value = e.currentTarget.dataset.date
    if (!value || value === this.data.selectedDate) return
    this.setData({ selectedDate: value }); await this.loadList(true)
  },
  getReservationsByDate(date, reservations) {
    return reservations.filter(item => item.date === date)
  },
  getUniqueReservationUsers(reservations) {
    return [...new Set(reservations.map(item => String(item.userName || '').trim()).filter(Boolean))]
  },
  generateNext7Days(reservations = [], base = new Date()) {
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate())
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
      const value = formatDate(date)
      const dayReservations = this.getReservationsByDate(value, reservations)
      const uniqueUsers = this.getUniqueReservationUsers(dayReservations)
      return {
        date: value,
        dateText: `${date.getMonth() + 1}/${date.getDate()}`,
        weekText: index === 0 ? '今天' : WEEK_TEXTS[date.getDay()],
        userNames: uniqueUsers.slice(0, 2),
        extraUserCount: Math.max(0, uniqueUsers.length - 2),
        reservationCount: dayReservations.length,
        isToday: index === 0
      }
    })
  },
  async loadWeekOverview() {
    const base = new Date()
    const emptyWeek = this.generateNext7Days([], base)
    const startAt = dateRange(emptyWeek[0].date)[0]
    const endAt = dateRange(emptyWeek[6].date)[1]
    const deviceId = this.data.deviceId
    const requestId = (this.weekRequestId || 0) + 1
    this.weekRequestId = requestId
    let page = 1, reservations = [], hasMore = true
    while (hasMore) {
      const result = await call('admin', 'listReservations', { startAt, endAt, deviceId, page, pageSize: 50 })
      const currentItems = result.items || []
      reservations = reservations.concat(currentItems)
      hasMore = Boolean(result.hasMore) && currentItems.length > 0
      page += 1
    }
    if (requestId !== this.weekRequestId || deviceId !== this.data.deviceId) return
    this.setData({ weekDays: this.generateNext7Days(reservations, base) })
  },
  async refresh() {
    this.setData({ loading: true })
    try {
      await this.loadWeekOverview()
      await this.loadList(true)
    } finally { this.setData({ loading: false }) }
  },
  async loadList(reset) {
    if (!reset && this.listLoading) return
    const selectedDate = this.data.selectedDate, deviceId = this.data.deviceId
    const requestId = reset ? (this.listRequestId || 0) + 1 : this.listRequestId
    if (reset) this.listRequestId = requestId
    this.listLoading = true
    try {
      const page = reset ? 1 : this.data.page + 1, [startAt, endAt] = dateRange(selectedDate)
      const result = await call('admin', 'listReservations', { startAt, endAt, deviceId, page, pageSize: 20 })
      if (requestId !== this.listRequestId || selectedDate !== this.data.selectedDate || deviceId !== this.data.deviceId) return
      this.setData({ items: reset ? result.items : this.data.items.concat(result.items), total: result.total, page, hasMore: result.hasMore, summary: result.summary || this.data.summary })
    } finally { if (requestId === this.listRequestId) this.listLoading = false }
  },
  loadMore() { if (this.data.hasMore) this.loadList(false) },
  openDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/admin/reservation-detail?id=${encodeURIComponent(id)}` })
  }
})
