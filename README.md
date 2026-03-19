# Vendor Bot (Node.js)

Telegram bot for supplier directory with strict access control:

- Only approved users can browse suppliers.
- Only admins can add suppliers.
- Only owner can assign new admins.
- Supplier contacts are encrypted in storage and are not stored in source code.

## Features

- Access request flow on `/start`
- Roles: `owner`, `admin`, `supplier`, `pending`
- Pending approvals list for admins
- User self-leave (`/leave`)
- Admin remove user with Yes/No confirmation
- Role-based menu (users do not see admin actions)
- Search suppliers with explicit mode: by name or by maker
- Help button in menu with English main-feature guide
- Supplier list with categories and subcategories
- Contact data encryption at rest (`AES-256-GCM`)
- Local encrypted JSON storage file

## Categories Included

- Local
  - India (Sikka)
  - Singapore
  - UAE
  - Turkey
  - Egypt
  - Malta
  - Spain
  - Netherlands (Rotterdam)
  - Denmark (Skagen)
  - Baltic
  - China
- Paint
- Lub oil
- Spare Parts
  - For Japan makers
  - Engines
  - Diesel Engines
  - Separators and FWG
  - Compressors and pumps
    - Refrigeration compressors
    - Air compressors
    - Pumps
  - Turbocharges
  - Boilers, incinerator and IGS
  - Plate heat exchangers
  - Electrical motors
  - Filters
  - Electrical parts
  - Hydraulic
  - Additional
    - India

## Setup

1. Install Node.js 20+
2. Install dependencies:

```bash
npm install
```

3. Copy `.env.example` to `.env` and fill values:

- `BOT_TOKEN` - Telegram bot token from BotFather
- `OWNER_ID` - your Telegram numeric user id
- `CONTACTS_SECRET` - long random secret for contact encryption
- `DATABASE_PATH` - optional path to encrypted JSON data file (default `data/vendors.db`)

Example secret generator:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

4. Start the bot:

```bash
npm start
```

## Commands

- `/start` - register and request access
- `/help` - list commands
- `/browse` - browse suppliers by category
- `/search` - choose mode and search by supplier name or maker
- `/leave` - remove your own access from the bot
- `/pending` - list pending users (admin/owner)
- `/users` - list removable users (admin/owner)
- `/approve <telegram_id>` - approve user (admin/owner)
- `/removeuser <telegram_id>` - ask Yes/No confirmation, then remove user (admin/owner)
- `/addsupplier` - add supplier (admin/owner)
- `/deletesupplier <supplier_id>` - ask Yes/No confirmation, then delete supplier (admin/owner)
- `/makeadmin <telegram_id>` - grant admin role (owner only)
- `/cancel` - cancel add supplier flow

## Bulk Import From VS Code

If you want to fill the supplier base before launching the bot, use the JSON import.

1. Open [suppliers.json](suppliers.json) in VS Code.
2. Replace the example entries with your real suppliers.
3. For each supplier, set a full final category path in `categoryPath`.
4. If a category has subcategories, you must point to the final subcategory.

Valid examples:

```json
{"categoryPath": ["Paint"]}
{"categoryPath": ["Local", "India (Sikka)"]}
{"categoryPath": ["Spare Parts", "Additional", "India"]}
```

Invalid example:

```json
{"categoryPath": ["Spare Parts", "Additional"]}
```

Run import:

```bash
npm run import:suppliers -- suppliers.json --replace
```

Modes:

- `--replace` - clears current suppliers and imports from file
- without `--replace` - appends new suppliers to existing base

Import validation checks:

- `name` is required
- `maker` is optional
- `remarks` is optional (example: `Egypt only`)
- `email` is required
- `phone` is optional
- `categoryPath` must exist and end at a final allowed category

## Security Notes

- Contacts (email and phone) are encrypted before writing to DB.
- Users with role `pending` cannot browse categories or contacts.
- If `CONTACTS_SECRET` is changed, existing encrypted contacts cannot be decrypted.
