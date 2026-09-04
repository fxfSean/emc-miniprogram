# 设备独立签到位置设计

## 数据模型

`devices` 增加：

```json
{
  "location": "机械楼 302 实验室东侧",
  "checkInSite": {
    "name": "机械楼",
    "address": "校内机械楼",
    "latitude": 31.2304,
    "longitude": 121.4737,
    "radiusMeters": 100
  },
  "locationVersion": 1,
  "locationUpdatedAt": "serverDate",
  "locationUpdatedBy": "adminUserId"
}
```

`reservations.checkInLocation` 在现有用户定位、精度和距离之外增加目标地点名称、地址、目标坐标、半径、设备文字位置、配置来源和位置版本。

## 管理端

设备编辑弹层使用 `wx.chooseLocation` 打开微信地图。选点返回后以内嵌 `map` 预览中心点和围栏范围；管理员补充设备在建筑内的具体位置并设置独立签到半径。旧设备没有独立配置时，表单使用全局位置作为迁移默认值，并在保存后写入设备。

## 签到流程

1. 云函数通过预约 ID 和可信用户身份读取预约。
2. 根据 `deviceId` 读取设备签到配置。
3. 优先使用设备 `checkInSite`，缺失时回退到旧 `settings/reservation.checkInSite`。
4. 服务端校验用户定位精度并计算 Haversine 距离。
5. 事务中重新读取预约和设备；若位置版本或坐标变化，拒绝本次请求并要求重新签到。
6. 写入签到状态、服务器时间及完整位置审计快照。

## 接口与隐私

- `admin.saveDevice` 校验并保存设备签到配置及位置版本。
- `device.list/detail` 仅对管理员返回精确签到配置；普通用户只获得地点名称、地址和是否已配置。
- `reservation.mine` 返回设备可读位置，不返回目标经纬度。
- `app.json` 声明 `chooseLocation`，并更新位置用途说明。

## 兼容策略

保留旧全局坐标和半径作为只读回退。新版预约规则页不再编辑全局签到点；管理员逐台保存设备后即可完成自然迁移。全部设备完成迁移后可在后续版本删除回退逻辑。

## 测试重点

- 地图选点成功、取消、拒绝权限和重新选择。
- 不同设备使用不同围栏。
- 设备配置优先于全局回退。
- 范围外、定位精度不足、设备位置并发变化。
- 普通用户接口不泄露目标经纬度。
