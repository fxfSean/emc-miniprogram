const { call } = require('../../utils/cloud')
const { requestNotificationTemplates, saveSubscriptionResults } = require('../../utils/notifications')

const pad = n => String(n).padStart(2, '0')
const formatDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const today = () => formatDate(new Date())
const minutesToTime = minutes => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
const dateTime = (date, time) => Date.parse(`${date}T${time}:00+08:00`)
const addDays = (date, days) => {
  const value = new Date(`${date}T12:00:00+08:00`)
  value.setDate(value.getDate() + days)
  return formatDate(value)
}

Page({
  data: {
    device: null,
    date: today(),
    selectedDateLabel: '',
    calendarTitle: '',
    calendarDays: [],
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    timeSlots: [],
    startTime: '',
    endTime: '',
    hasSelection: false,
    selectionText: '请选择连续空闲时段',
    reason: '',
    maxAdvanceDays: 7,
    ruleTexts: ['每人每天最多预约 4 小时', '每人最多同时持有 3 个有效预约', '可预约未来 7 天内的时段（以当前时间为准）'],
    loading: true,
    submitting: false
  },

  onLoad(query) {
    this.deviceId = query.deviceId
    const now = new Date()
    this.calendarYear = now.getFullYear()
    this.calendarMonth = now.getMonth() + 1
    this.selectedStartIndex = -1
    this.selectedEndIndex = -1
    this.baseSlots = []
    this.buildCalendar()
  },

  async onShow() { await this.load() },

  buildCalendar() {
    const { date, maxAdvanceDays } = this.data
    const firstWeekday = new Date(this.calendarYear, this.calendarMonth - 1, 1).getDay()
    const dayCount = new Date(this.calendarYear, this.calendarMonth, 0).getDate()
    const todayValue = today()
    const maxDate = addDays(todayValue, maxAdvanceDays)
    const days = []
    for (let i = 0; i < firstWeekday; i += 1) days.push({ key: `blank-start-${i}`, empty: true })
    for (let day = 1; day <= dayCount; day += 1) {
      const value = `${this.calendarYear}-${pad(this.calendarMonth)}-${pad(day)}`
      const disabled = value < todayValue || value > maxDate
      days.push({ key: value, day, value, empty: false, disabled, today: value === todayValue, selected: value === date })
    }
    while (days.length % 7) days.push({ key: `blank-end-${days.length}`, empty: true })
    const selected = new Date(`${date}T12:00:00+08:00`)
    this.setData({
      calendarTitle: `${this.calendarYear} 年 ${this.calendarMonth} 月`,
      calendarDays: days,
      selectedDateLabel: `${selected.getMonth() + 1}月${selected.getDate()}日`
    })
  },

  changeMonth(e) {
    const delta = Number(e.currentTarget.dataset.delta)
    const next = new Date(this.calendarYear, this.calendarMonth - 1 + delta, 1)
    this.calendarYear = next.getFullYear()
    this.calendarMonth = next.getMonth() + 1
    this.buildCalendar()
  },

  async selectDate(e) {
    const { value, disabled } = e.currentTarget.dataset
    if (!value || disabled) return
    this.setData({ date: value })
    this.buildCalendar()
    await this.loadAvailability()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const device = await call('device', 'detail', { id: this.deviceId })
      this.setData({ device })
      await this.loadAvailability()
    } finally {
      this.setData({ loading: false })
    }
  },

  async loadAvailability() {
    const requestId = (this.availabilityRequestId || 0) + 1
    this.availabilityRequestId = requestId
    this.setData({ loading: true })
    try {
      const result = await call('reservation', 'availability', { deviceId: this.deviceId, date: this.data.date })
      if (requestId !== this.availabilityRequestId) return
      const availability = Array.isArray(result) ? { reservations: result, blocks: [] } : result
      const rules = availability.rules || {}
      const maxAdvanceDays = Number(rules.maxAdvanceDays || availability.maxAdvanceDays || this.data.maxAdvanceDays)
      const dailyMinutes = Number(rules.maxDailyMinutes || 240)
      const dailyText = dailyMinutes % 60 === 0 ? `${dailyMinutes / 60} 小时` : `${dailyMinutes} 分钟`
      const activeCount = Number(rules.maxActiveReservations || 3)
      this.selectedStartIndex = -1
      this.selectedEndIndex = -1
      this.baseSlots = this.createSlots(availability.reservations || [], availability.blocks || [])
      this.setData({
        maxAdvanceDays,
        ruleTexts: [`每人每天最多预约 ${dailyText}`, `每人最多同时持有 ${activeCount} 个有效预约`, `可预约未来 ${maxAdvanceDays} 天内的时段（以当前时间为准）`],
        startTime: '', endTime: '', hasSelection: false, selectionText: '请选择连续空闲时段', timeSlots: this.baseSlots
      })
      this.buildCalendar()
    } finally {
      if (requestId === this.availabilityRequestId) this.setData({ loading: false })
    }
  },

  createSlots(reservations, blocks) {
    const now = Date.now()
    return Array.from({ length: 48 }, (_, index) => {
      const startTime = minutesToTime(index * 30)
      const endTime = minutesToTime((index + 1) * 30)
      const startAt = dateTime(this.data.date, startTime)
      const endAt = dateTime(this.data.date, endTime)
      const blocked = blocks.find(item => item.startAt < endAt && item.endAt > startAt)
      const booked = reservations.find(item => item.startAt < endAt && item.endAt > startAt)
      let status = 'AVAILABLE'
      let statusText = '空闲'
      if (startAt <= now) {
        status = 'PAST'
        statusText = '已过期'
      } else if (this.data.device && this.data.device.status !== 'AVAILABLE') {
        status = 'BLOCKED'
        statusText = this.data.device.statusText || '不可用'
      } else if (blocked) {
        status = 'BLOCKED'
        statusText = blocked.label || '维护禁用'
      } else if (booked) {
        status = booked.ownership === 'MINE' ? 'MINE' : 'OCCUPIED'
        statusText = booked.ownership === 'MINE' ? '我的预约' : (booked.ownerName || '已预约')
      }
      return { index, startTime, endTime, timeText: startTime, status, statusText, selectable: status === 'AVAILABLE' }
    })
  },

  selectSlot(e) {
    const index = Number(e.currentTarget.dataset.index)
    const target = this.baseSlots[index]
    if (!target || !target.selectable) return wx.showToast({ title: target ? target.statusText : '该时段不可选', icon: 'none' })
    let start = this.selectedStartIndex
    let end = this.selectedEndIndex
    if (start < 0) {
      start = index
      end = index
    } else if (index >= start && index <= end) {
      if (start === end) { start = -1; end = -1 }
      else if (index === start) start += 1
      else if (index === end) end -= 1
      else { start = index; end = index }
    } else {
      const nextStart = Math.min(start, index)
      const nextEnd = Math.max(end, index)
      const continuous = this.baseSlots.slice(nextStart, nextEnd + 1).every(slot => slot.selectable)
      if (!continuous) return wx.showToast({ title: '所选区间包含不可用时段', icon: 'none' })
      start = nextStart
      end = nextEnd
    }
    this.applySelection(start, end)
  },

  applySelection(start, end) {
    this.selectedStartIndex = start
    this.selectedEndIndex = end
    const hasSelection = start >= 0 && end >= start
    const startTime = hasSelection ? this.baseSlots[start].startTime : ''
    const endTime = hasSelection ? this.baseSlots[end].endTime : ''
    const timeSlots = this.baseSlots.map((slot, index) => ({ ...slot, selected: hasSelection && index >= start && index <= end }))
    this.setData({ timeSlots, startTime, endTime, hasSelection, selectionText: hasSelection ? `${startTime}–${endTime}` : '请选择连续空闲时段' })
  },

  reasonInput(e) { this.setData({ reason: e.detail.value }) },

  async submit() {
    const { date, startTime, endTime, reason, hasSelection } = this.data
    if (!hasSelection) return wx.showToast({ title: '请选择预约时段', icon: 'none' })
    if (!reason.trim()) return wx.showToast({ title: '请填写实验内容', icon: 'none' })
    this.setData({ submitting: true })
    try {
      const subscriptionResults = await requestNotificationTemplates(['reservationCreated', 'reservationCancelled', 'reminder'])
      await saveSubscriptionResults(subscriptionResults)
      await call('reservation', 'create', { deviceId: this.deviceId, date, startTime, endTime, reason: reason.trim() })
      wx.showToast({ title: '预约成功' })
      setTimeout(() => wx.switchTab({ url: '/pages/mine/index' }), 600)
    } finally { this.setData({ submitting: false }) }
  }
})
