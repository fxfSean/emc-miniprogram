const { call } = require('../../utils/cloud')
const blank = () => ({ _id: '', deviceNo: '', name: '', model: '', manufacturer: '', location: '', description: '', status: 'AVAILABLE' })
Page({
  data: { devices: [], editing: false, form: blank(), statuses: ['AVAILABLE', 'MAINTENANCE', 'DISABLED'], statusNames: ['可预约', '维护中', '已停用'], statusIndex: 0, processing: '' },
  async onShow() { await this.load() },
  async load() { this.setData({ devices: await call('device', 'list', { includeDisabled: true }) }) },
  add() { this.setData({ editing: true, form: blank(), statusIndex: 0 }) },
  edit(e) { const form = this.data.devices.find(x => x._id === e.currentTarget.dataset.id); this.setData({ editing: true, form, statusIndex: this.data.statuses.indexOf(form.status) }) },
  input(e) { this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value }) },
  status(e) { const i = Number(e.detail.value); this.setData({ statusIndex: i, 'form.status': this.data.statuses[i] }) },
  noop() {},
  close() { if (!this.data.processing) this.setData({ editing: false }) },
  async save() {
    const { form } = this.data
    if (this.data.processing) return
    if (!form.deviceNo || !form.name) return wx.showToast({ title: '编号和名称为必填项', icon: 'none' })
    this.setData({ processing: 'SAVE' })
    try {
      await call('admin', 'saveDevice', { device: form })
      this.setData({ editing: false })
      await this.load()
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
      this.setData({ editing: false })
      await this.load()
    } finally {
      this.setData({ processing: '' })
    }
  }
})
