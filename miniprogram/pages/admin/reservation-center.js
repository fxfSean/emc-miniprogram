Page({
  records() { wx.navigateTo({ url: '/pages/admin/reservations' }) },
  create() { wx.navigateTo({ url: '/pages/admin/reservation-create' }) },
  blocks() { wx.navigateTo({ url: '/pages/admin/device-blocks' }) },
  rules() { wx.navigateTo({ url: '/pages/admin/reservation-rules' }) }
})
