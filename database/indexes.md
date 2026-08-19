# Recommended indexes

Create these indexes in CloudBase console before integration testing.

| Collection | Fields |
| --- | --- |
| `users` | `openid` ascending (unique) |
| `users` | `status` ascending, `createdAt` ascending |
| `devices` | `deviceNo` ascending (unique) |
| `reservations` | `deviceId` ascending, `status` ascending, `startAt` ascending, `endAt` ascending |
| `reservations` | `userId` ascending, `status` ascending, `endAt` ascending |
| `reservations` | `userId` ascending, `startAt` descending |
| `device_blocks` | `deviceId` ascending, `startAt` ascending, `endAt` ascending |

All business collections should use the CloudBase permission preset "admin only". The mini program accesses them through cloud functions.
