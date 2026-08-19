async function requireApproved() {
  const app = getApp()
  const user = await app.loadSession(true)
  if (!user) { wx.redirectTo({ url: '/pages/profile/register' }); return null }
  if (user.status !== 'APPROVED') { wx.redirectTo({ url: '/pages/profile/status' }); return null }
  return user
}
module.exports = { requireApproved }
