# EMC Laboratory Reservation

P0 implementation of an internal laboratory equipment reservation mini program, built with native WeChat Mini Program and CloudBase.

## Included

- WeChat identity session and laboratory profile binding
- Pending, approved, rejected, and disabled user states
- Administrator member review
- Equipment list, search, details, creation, and editing
- Availability display and reservation creation
- Transaction-protected overlap checks per device and date
- Upcoming/history views and reservation cancellation
- Private reservation purpose: approved users see the reserver name and occupied time range, but never the reservation purpose

## Project layout

```text
miniprogram/       Mini Program UI
cloudfunctions/    user, device, reservation, and admin functions
database/          Initial settings, sample device, and index guide
```

## CloudBase setup

1. Open this directory in WeChat DevTools and replace `touristappid` in `project.config.json` with the formal Mini Program AppID.
2. Create a CloudBase environment and set its environment ID in `miniprogram/app.js` (`globalData.envId`). Leaving it empty uses the environment selected by DevTools.
3. Create these collections with the "admin only" permission preset:
   `users`, `devices`, `reservations`, `reservation_locks`, `device_blocks`, and `settings`.
4. Add `database/settings.reservation.json` as document `reservation` in `settings`.
5. Optionally add `database/devices.sample.json` to `devices`.
6. Create the indexes listed in `database/indexes.md`.
7. In DevTools, right-click each directory under `cloudfunctions`, choose "Upload and deploy: cloud install dependencies".

## First administrator

Register once through the Mini Program, then edit that user's document in CloudBase console:

```json
{
  "role": "ADMIN",
  "status": "APPROVED"
}
```

Refresh the Mini Program. The "Manage" button will appear under "My Reservations". Subsequent users can be approved there.

## Data and review notes

- Do not import real member information into a personal development AppID.
- Before release, configure the Mini Program privacy protection guide for name, student/employee number, advisor, phone number, and reservation records.
- The P0 build does not request location, camera, album, or subscription-message permissions.
- Keep production and development CloudBase environments separate.
