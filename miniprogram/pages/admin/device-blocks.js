const { call } = require('../../utils/cloud')
const pad = value => String(value).padStart(2, '0')
const formatDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const addDays = days => { const date = new Date(); date.setDate(date.getDate() + days); return formatDate(date) }
const initialForm = () => ({ deviceIndex: -1, deviceId: '', startDate: addDays(1), startTime: '09:00', endDate: addDays(1), endTime: '12:00', categoryIndex: 0, category: 'MAINTENANCE', reason: '' })

Page({
  data: { devices: [], deviceNames: ['全部设备'], selectDeviceNames: [], filterIndex: 0, filterDeviceId: '', blocks: [], categories: ['MAINTENANCE', 'HOLIDAY', 'OTHER'], categoryNames: ['设备维护', '假期停用', '其他原因'], categoryLabels: { MAINTENANCE: '设备维护', HOLIDAY: '假期停用', OTHER: '其他原因' }, editing: false, form: initialForm(), saving: false },
  async onLoad() { await this.loadDevices(); await this.load() },
  async loadDevices() { const devices = await call('device', 'list', { includeDisabled: true }); const selectDeviceNames = devices.map(item => `${item.deviceNo} · ${item.name}`); this.setData({ devices, selectDeviceNames, deviceNames: ['全部设备', ...selectDeviceNames] }) },
  async load() {
    const startAt = Date.parse(`${addDays(-30)}T00:00:00+08:00`), endAt = Date.parse(`${addDays(335)}T23:59:59+08:00`)
    const blocks = await call('admin', 'listDeviceBlocks', { startAt, endAt, deviceId: this.data.filterDeviceId })
    this.setData({ blocks })
  },
  async filterChange(e) { const filterIndex = Number(e.detail.value), device = this.data.devices[filterIndex - 1]; this.setData({ filterIndex, filterDeviceId: device ? device._id : '' }); await this.load() },
  add() { const form = initialForm(); if (this.data.filterDeviceId) { form.deviceId = this.data.filterDeviceId; form.deviceIndex = this.data.devices.findIndex(item => item._id === form.deviceId) } this.setData({ editing: true, form }) },
  close() { if (!this.data.saving) this.setData({ editing: false }) },
  noop() {},
  deviceChange(e) { const deviceIndex = Number(e.detail.value); this.setData({ 'form.deviceIndex': deviceIndex, 'form.deviceId': this.data.devices[deviceIndex]._id }) },
  categoryChange(e) { const categoryIndex = Number(e.detail.value); this.setData({ 'form.categoryIndex': categoryIndex, 'form.category': this.data.categories[categoryIndex] }) },
  valueChange(e) { this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value }) },
  async save() {
    const form = this.data.form
    if (!form.deviceId) return wx.showToast({ title: '请选择设备', icon: 'none' })
    if (!form.reason.trim()) return wx.showToast({ title: '请填写禁用原因', icon: 'none' })
    const startAt = Date.parse(`${form.startDate}T${form.startTime}:00+08:00`), endAt = Date.parse(`${form.endDate}T${form.endTime}:00+08:00`)
    this.setData({ saving: true })
    try { await call('admin', 'createDeviceBlock', { deviceId: form.deviceId, startAt, endAt, category: form.category, reason: form.reason.trim() }); wx.showToast({ title: '禁用时段已添加' }); this.setData({ editing: false }); await this.load() }
    finally { this.setData({ saving: false }) }
  },
  remove(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({ title: '恢复开放？', content: '删除该禁用时段后，用户可重新预约对应时间。', confirmText: '恢复开放', confirmColor: '#176B5B', success: async result => { if (!result.confirm) return; await call('admin', 'deleteDeviceBlock', { id }); wx.showToast({ title: '已恢复开放' }); await this.load() } })
  }
})
