# AGENTS.md

## Project

This is a WeChat Mini Program for laboratory equipment reservations.

Main stack:
- WeChat Mini Program
- JavaScript / TypeScript
- WeChat CloudBase
- Cloud Functions
- Cloud Database
- Cloud Storage

## UI Guidelines

- Keep the UI clean, simple, and professional.
- Prefer a modern laboratory / technology visual style.
- Keep visual styles consistent across pages.
- Do not use emoji as production UI icons.
- Reuse existing components and styles before creating new ones.

## Icons

When adding or replacing UI icons:

1. Search IconFont through the configured IconFont MCP server.
2. Prefer simple outline / line icons.
3. Keep stroke weight and visual style consistent with existing icons.
4. Search using both Chinese and English semantic keywords.
5. Do not use emoji as production UI icons.
6. Reuse an existing project icon when one already represents the action.
7. Store/import icons using the project's existing iconfont component.
8. Do not change page layout unless explicitly requested.

Suggested icon semantics:
- Device: device / equipment / 仪器 / 设备
- Reservation: calendar / schedule / 预约 / 日历
- Repair: repair / tool / 维修 / 报修
- User: user / profile / 用户
- Notification: bell / notification / 通知
- Location: location / pin / 位置
- Search: search / 搜索
- Filter: filter / 筛选

## CloudBase

- Core business data must be accessed through Cloud Functions.
- Do not trust userId or role passed from the Mini Program frontend.
- Determine user identity from the WeChat CloudBase context.
- Authorization checks must be performed in Cloud Functions.
- Reservation conflict checks must be performed on the backend.
- Use transactions or atomic operations for reservation creation when needed.

## Code Changes

- Prefer minimal changes.
- Do not refactor unrelated code.
- Preserve existing page layouts unless the task explicitly requires redesign.
- Before creating a new utility/component, check whether an equivalent already exists.