# Recommended indexes

Create these indexes in CloudBase console before integration testing.

| Collection | Fields |
| --- | --- |
| `users` | `openid` ascending (unique) |
| `users` | `status` ascending, `createdAt` ascending |
| `devices` | `deviceNo` ascending (unique) |
| `reservations` | `deviceId` ascending, `status` ascending, `startAt` ascending, `endAt` ascending |
| `reservations` | `userId` ascending, `status` ascending, `endAt` ascending |
| `reservations` | `userId` ascending, `status` ascending, `startAt` ascending |
| `reservations` | `userId` ascending, `startAt` descending |
| `reservations` | `status` ascending, `startAt` ascending |
| `reservations` | `startAt` ascending |
| `reservations` | `deviceId` ascending, `startAt` ascending |
| `device_blocks` | `deviceId` ascending, `startAt` ascending, `endAt` ascending |
| `device_blocks` | `startAt` ascending |
| `notifications` | `recipientUserId` ascending, `createdAt` descending |
| `notifications` | `recipientUserId` ascending, `readAt` ascending |
| `notifications` | `pushStatus` ascending, `createdAt` ascending |
| `announcements` | `status` ascending, `startsAt` ascending, `endsAt` ascending |
| `announcements` | `publishedAt` descending |
| `announcement_reads` | `userId` ascending, `readAt` descending |
| `notification_deliveries` | `status` ascending, `createdAt` ascending |

All business collections should use the CloudBase permission preset "admin only". The mini program accesses them through cloud functions.

Device-specific check-in locations are stored in the existing `devices.checkInSite` object with `locationVersion` and audit fields. No new collection or index is required. During migration, devices without this object continue to use the legacy `settings/reservation.checkInSite` and `checkInRadiusMeters` values as a read-only fallback.
