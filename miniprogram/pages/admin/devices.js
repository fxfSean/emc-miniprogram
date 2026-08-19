const { call } = require('../../utils/cloud')
const blank = () => ({ _id: '', deviceNo: '', name: '', model: '', manufacturer: '', location: '', description: '', status: 'AVAILABLE' })
Page({
  data: { devices: [], editing: false, form: blank(), statuses: ['AVAILABLE', 'MAINTENANCE', 'DISABLED'], statusNames: ['可预约', '维护中', '已停用'], statusIndex: 0 },
  async onShow() { await this.load() },
  async load() { this.setData({ devices: await call('device', 'list', { includeDisabled: true }) }) },
  add() { this.setData({ editing: true, form: blank(), statusIndex: 0 }) },
  edit(e) { const form = this.data.devices.find(x => x._id === e.currentTarget.dataset.id); this.setData({ editing: true, form, statusIndex: this.data.statuses.indexOf(form.status) }) },
  input(e) { this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value }) },
  status(e) { const i = Number(e.detail.value); this.setData({ statusIndex: i, 'form.status': this.data.statuses[i] }) },
  noop() {},
  close() { this.setData({ editing: false }) },
  async save() { const { form } = this.data; if (!form.deviceNo || !form.name) return wx.showToast({ title: '编号和名称为必填项', icon: 'none' }); await call('admin', 'saveDevice', { device: form }); this.close(); await this.load() }
})
