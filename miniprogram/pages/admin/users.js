const { call } = require('../../utils/cloud')
Page({
  data: { users: [] },
  async onShow() { await this.load() },
  async load() { this.setData({ users: await call('admin', 'pendingUsers') }) },
  async approve(e) { await call('admin', 'reviewUser', { id: e.currentTarget.dataset.id, decision: 'APPROVED' }); await this.load() },
  reject(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({ title: '驳回资料', editable: true, placeholderText: '请输入驳回原因', success: async r => { if (r.confirm) { await call('admin', 'reviewUser', { id, decision: 'REJECTED', note: r.content }); await this.load() } } })
  }
})
