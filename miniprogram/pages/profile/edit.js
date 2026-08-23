const { call } = require('../../utils/cloud')
const { requireApproved } = require('../../utils/auth')

Page({
  data: {
    name: '',
    studentNo: '',
    advisor: '',
    phone: '',
    loading: true,
    submitting: false
  },

  async onLoad() {
    try {
      const user = await requireApproved()
      if (!user) return
      this.originalProfile = {
        name: String(user.name || ''),
        studentNo: String(user.studentNo || ''),
        advisor: String(user.advisor || ''),
        phone: String(user.phone || '')
      }
      this.setData({ ...this.originalProfile })
    } finally {
      this.setData({ loading: false })
    }
  },

  input(e) { this.setData({ [e.currentTarget.dataset.key]: e.detail.value }) },

  async submit() {
    if (this.data.submitting) return
    const profile = {
      name: this.data.name.trim(),
      studentNo: this.data.studentNo.trim(),
      advisor: this.data.advisor.trim(),
      phone: this.data.phone.trim()
    }
    if (!profile.name || !profile.studentNo || !profile.advisor) return wx.showToast({ title: '请填写必填信息', icon: 'none' })
    if (profile.phone && !/^1\d{10}$/.test(profile.phone)) return wx.showToast({ title: '手机号格式不正确', icon: 'none' })
    const original = this.originalProfile || {}
    const identityChanged = ['name', 'studentNo', 'advisor'].some(key => profile[key] !== original[key])
    const changed = identityChanged || profile.phone !== original.phone
    if (!changed) return wx.showToast({ title: '资料没有变化', icon: 'none' })
    if (identityChanged) {
      const confirmed = await new Promise(resolve => wx.showModal({
        title: '需要重新审核',
        content: '姓名、学号/工号或导师发生变化，保存后需等待管理员重新审核。是否继续？',
        confirmText: '继续保存',
        success: result => resolve(result.confirm),
        fail: () => resolve(false)
      }))
      if (!confirmed) return
    }
    this.setData({ submitting: true })
    try {
      const result = await call('user', 'updateProfile', profile)
      getApp().clearSession()
      if (result.requiresReview) {
        wx.showToast({ title: '已提交重新审核', icon: 'success' })
        setTimeout(() => wx.redirectTo({ url: '/pages/profile/status' }), 600)
      } else {
        wx.showToast({ title: '个人信息已更新', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 600)
      }
    } finally {
      this.setData({ submitting: false })
    }
  }
})
