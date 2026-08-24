const { call } = require('../../utils/cloud')
const pad = value => String(value).padStart(2, '0')
const formatDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const minutesToTime = value => `${pad(Math.floor(value / 60))}:${pad(value % 60)}`
const dateTime = (date, time) => Date.parse(`${date}T${time}:00+08:00`)

Page({
  data: { keyword: '', users: [], userNames: [], userIndex: -1, userId: '', devices: [], deviceNames: [], deviceIndex: -1, deviceId: '', date: formatDate(new Date()), slots: [], startTime: '', endTime: '', selectionText: '请选择连续时段', reason: '', loading: false, submitting: false },
  async onLoad() { await Promise.all([this.loadUsers(), this.loadDevices()]) },
  keywordInput(e) { this.setData({ keyword: e.detail.value }) },
  async loadUsers() {
    const result = await call('admin', 'listUsers', { status: 'APPROVED', keyword: this.data.keyword })
    const users = result.users.filter(item => item.role !== 'ADMIN')
    this.setData({ users, userNames: users.map(item => `${item.name} · ${item.studentNo}`), userIndex: users.some(item => item._id === this.data.userId) ? users.findIndex(item => item._id === this.data.userId) : -1 })
  },
  searchUsers() { this.loadUsers() },
  userChange(e) { const userIndex = Number(e.detail.value); this.setData({ userIndex, userId: this.data.users[userIndex]._id }) },
  async loadDevices() {
    const devices = (await call('device', 'list', { includeDisabled: true })).filter(item => item.status === 'AVAILABLE')
    this.setData({ devices, deviceNames: devices.map(item => `${item.deviceNo} · ${item.name}`) })
  },
  async deviceChange(e) { const deviceIndex = Number(e.detail.value); this.setData({ deviceIndex, deviceId: this.data.devices[deviceIndex]._id }); await this.loadAvailability() },
  async dateChange(e) { this.setData({ date: e.detail.value }); if (this.data.deviceId) await this.loadAvailability() },
  async loadAvailability() {
    this.setData({ loading: true })
    try {
      const result = await call('reservation', 'availability', { deviceId: this.data.deviceId, date: this.data.date })
      const now = Date.now(), reservations = result.reservations || [], blocks = result.blocks || []
      this.baseSlots = Array.from({ length: 48 }, (_, index) => {
        const startTime = minutesToTime(index * 30), endTime = minutesToTime((index + 1) * 30), startAt = dateTime(this.data.date, startTime), endAt = dateTime(this.data.date, endTime)
        const occupied = reservations.some(item => item.startAt < endAt && item.endAt > startAt), blocked = blocks.some(item => item.startAt < endAt && item.endAt > startAt)
        const available = startAt > now && !occupied && !blocked
        return { index, startTime, endTime, status: available ? 'AVAILABLE' : (blocked ? 'BLOCKED' : (occupied ? 'OCCUPIED' : 'PAST')), selected: false }
      })
      this.startIndex = -1; this.endIndex = -1
      this.setData({ slots: this.baseSlots, startTime: '', endTime: '', selectionText: '请选择连续时段' })
    } finally { this.setData({ loading: false }) }
  },
  selectSlot(e) {
    const index = Number(e.currentTarget.dataset.index), target = this.baseSlots && this.baseSlots[index]
    if (!target || target.status !== 'AVAILABLE') return wx.showToast({ title: '该时段不可选', icon: 'none' })
    let start = this.startIndex, end = this.endIndex
    if (start < 0) start = end = index
    else {
      const nextStart = Math.min(start, index), nextEnd = Math.max(end, index)
      if (!this.baseSlots.slice(nextStart, nextEnd + 1).every(item => item.status === 'AVAILABLE')) return wx.showToast({ title: '所选区间包含不可用时段', icon: 'none' })
      start = nextStart; end = nextEnd
    }
    this.startIndex = start; this.endIndex = end
    const startTime = this.baseSlots[start].startTime, endTime = this.baseSlots[end].endTime
    this.setData({ startTime, endTime, selectionText: `${startTime}–${endTime}`, slots: this.baseSlots.map((item, slotIndex) => ({ ...item, selected: slotIndex >= start && slotIndex <= end })) })
  },
  clearSelection() { this.startIndex = -1; this.endIndex = -1; this.setData({ startTime: '', endTime: '', selectionText: '请选择连续时段', slots: (this.baseSlots || []).map(item => ({ ...item, selected: false })) }) },
  reasonInput(e) { this.setData({ reason: e.detail.value }) },
  async submit() {
    const { userId, deviceId, date, startTime, endTime, reason } = this.data
    if (!userId) return wx.showToast({ title: '请选择预约用户', icon: 'none' })
    if (!deviceId) return wx.showToast({ title: '请选择设备', icon: 'none' })
    if (!startTime || !endTime) return wx.showToast({ title: '请选择预约时段', icon: 'none' })
    if (!reason.trim()) return wx.showToast({ title: '请填写预约事由', icon: 'none' })
    this.setData({ submitting: true })
    try { await call('reservation', 'adminCreate', { userId, deviceId, date, startTime, endTime, reason: reason.trim() }); wx.showToast({ title: '代预约成功' }); setTimeout(() => wx.navigateBack(), 600) }
    finally { this.setData({ submitting: false }) }
  }
})
