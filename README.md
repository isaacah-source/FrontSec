# Relationship Tracker

A web app for tracking your organization's external contacts, built on top of the
relationship tracker workbook you already keep in OneDrive. People sign in with their
Microsoft 365 work account. The app reads and writes the workbook as that person, so
**whoever you share the folder with (for example in Microsoft Teams) can use the app, and
nobody else can.** There is no separate database and no separate password.

Works in any browser on a laptop or phone, and can be added to a phone's home screen.

## What it does

- **Contacts from the workbook.** The Master tab is the contact list. Every column keeps its
  meaning, and the category tabs (Fellows & Advisors, AI Labs, ...) keep working because the
  app never moves or renames columns A to T.
- **Near real-time.** The app checks OneDrive every 10 seconds and reloads when the file
  changes, including edits people make directly in Excel. It tells you when someone else
  updated a contact.
- **No lost edits.** If two people edit the same contact at once, the second save stops and
  shows the newer version. Saving a form writes only the fields you changed.
- **Assignment and follow-up.** Owners, statuses, next follow-up dates, a Today screen with
  overdue and upcoming follow-ups, and bulk assignment for editors.
- **Touchpoints.** Log a meeting, call, or email; Date of Last Contact moves forward and you
  can set the next follow-up in one tap.
- **Network map.** Contacts connected by organization, shared issue, personal connection,
  or the staff member who owns the relationship.
- **Business card scanning.** Take a photo on your phone and the form fills in. The photo is
  read on the device and never uploaded.
- **Roles.** Admin, editor, contributor, viewer (see *Access and roles*).
- **Demo mode.** Open the app with `?demo` at the end of the address to try it with sample
  data and no sign-in. Nothing is saved.

## What it adds to the workbook

The first admin to open the app clicks **Set up workbook**, which adds:

| Where | What |
|-------|------|
| Master, after column T | Title, LinkedIn, Website, Address, Updated At, Updated By |
| New tab **Touchpoints** | One row per logged meeting, call, or email |
| New tab **Connections** | One row per personal connection between two contacts |
| New tab **App Users** | Microsoft email, name, and app role for each person |

People can keep opening the workbook in Excel. Avoid renaming the Master tab or its column
headers, as the workbook's own README already advises.

## Access and roles

Two layers decide what a person can do:

1. **Microsoft 365 sharing (enforced by Microsoft).** Share the folder with someone and they
   can sign in and see the data. Share with *view* permission for read-only, *edit* permission
   for anyone who should add or change contacts. Remove their access and the app stops working
   for them.
2. **App roles (enforced by the app).** Kept in the App Users tab and set on the Admin page:

   | Role        | Can do |
   |-------------|--------|
   | admin       | Everything, including managing roles |
   | editor      | Add and edit any contact, assign owners, map connections |
   | contributor | Add contacts and log touchpoints; edit only contacts they own; claim unassigned ones |
   | viewer      | Read-only (the default for anyone not listed) |

   Anyone with *edit* permission on the folder can also open the workbook in Excel and change
   it directly, outside the app's roles. OneDrive's version history records every change.

**Restricted contacts.** The Restricted column is a label only. Everyone who can open the
workbook can read every row. Keep truly confidential contacts in a separate file that only
the right people can open.

## One-time setup (about 30 minutes)

Everything here is free. You need someone who can register apps in your Microsoft 365
tenant (usually a Microsoft 365 admin). No Azure subscription is required.

### 1. Register the app in Microsoft Entra ID

App registrations come with every Microsoft 365 tenant at no cost.

1. Go to the Microsoft Entra admin center (entra.microsoft.com), then **App registrations**,
   then **New registration**.
2. Name: `Relationship Tracker`. Supported account types: **Accounts in this organizational
   directory only**.
3. Redirect URI: platform **Single-page application (SPA)**, address
   `https://isaacah-source.github.io/FrontSec/` (the trailing slash matters).
   Add `http://localhost:5175/` as a second SPA redirect URI if you will test on a laptop.
4. Under **API permissions**, add Microsoft Graph **delegated** permissions `User.Read` and
   `Files.ReadWrite.All`, then click **Grant admin consent** if your organization requires it.
5. From **Overview**, copy the **Application (client) ID** and **Directory (tenant) ID**.

`Files.ReadWrite.All` lets the app open files *shared with* the signed-in person, not just
their own. The app only ever opens the one folder named in its configuration, and it can
never reach anything the person could not open themselves.

### 2. Publish with GitHub Pages

1. In this repository, open **Settings**, then **Pages**, and set **Source** to **GitHub Actions**.
   (GitHub serves Pages from a private repository only on a paid plan such as GitHub Pro. On
   the free plan, either upgrade or make this repository public. The code holds no contact
   data or secrets; the data stays in OneDrive behind Microsoft sign-in.)
2. Open **Settings**, then **Secrets and variables**, then **Actions**, then the **Variables**
   tab, and add:

   | Variable | Value |
   |----------|-------|
   | `TRACKER_TENANT_ID` | Directory (tenant) ID from step 1 |
   | `TRACKER_CLIENT_ID` | Application (client) ID from step 1 |
   | `TRACKER_FOLDER_URL` | The sharing link to the OneDrive folder that holds the workbook |
   | `TRACKER_WORKBOOK_NAME` | Optional: the workbook's file name, if the folder has more than one |
   | `TRACKER_SETUP_ADMINS` | Optional: comma-separated emails allowed to run first-time setup |

3. Push to `main` (or run **Deploy to GitHub Pages** from the **Actions** tab). The app goes
   live at `https://isaacah-source.github.io/FrontSec/` within a couple of minutes.

The published site is reachable on the internet like any website, and so is its settings
file, which contains the IDs and folder link above. None of them is a password: Microsoft
only lets a person in after they sign in, and only shows them the folder if it has been
shared with them. Make sure the folder's sharing link is set to "People in your organization"
or "Specific people", never "Anyone".

### 3. Share and start

1. Open the app's address and sign in. Click **Set up workbook**. You become the first admin.
2. Share the folder with your colleagues (from OneDrive, or by sharing it in a Teams channel
   or chat). Use edit permission for anyone who will add or change contacts.
3. On the app's **Admin** page, add each person's Microsoft email and role. Use the name
   exactly as it appears in Relationship Owner (for example "Susan Malandrino") so "My
   contacts" finds their contacts.
4. Send everyone the app's address. They sign in with their work account; on a phone they
   can choose **Add to Home Screen**.

### Recommended: keep the workbook in a Teams channel, not a personal OneDrive

The folder in the current link sits in one person's OneDrive. If that account is ever
removed, the folder goes with it. Moving the workbook into the **Files** tab of a Teams
channel stores it in the team's SharePoint site, and every member of the team gets access
automatically. Afterwards, use that folder's sharing link as `folderUrl`.

## Before the first real use

- **Duplicates in the current workbook.** The Master tab has six pairs of rows with the same
  email (for example two rows each for Ellen Nakashima and Jared Perlo, and "Jason Mathaney"
  next to "Jason Matheny"). The app shows both rows of each pair. Delete the extra rows in
  Excel or in the app.
- **Owner names.** Two contacts list the owner as "Ike". The app treats a lone first name as
  matching the person with that first name, but "Ike Harris" in full is clearer.

## Installing on a phone

**Android (Chrome):** open the app's address, sign in, then tap the **⋮** menu and choose
**Install app** (on some phones, **Add to Home screen**, then **Install**). The app gets its own
icon and opens full screen without the browser bar. The icon adapts to your phone's icon shape,
and on Android 13 or newer it follows themed icons if you have them turned on.

**iPhone (Safari):** open the app's address, tap the **Share** button, then **Add to Home Screen**.

The icons live in `public/icons` and are drawn by `icon-src/make-icons.mjs`. To change the
design, edit the drawing in that script and run `node icon-src/make-icons.mjs`.

## Relationship types

The app offers these types: Fellows, Advisors, Board, AI Labs, Media, Policy/NatSec/Gov,
Donors/Funders, Research/Institutional Partners, and International Gov/Diplomatic.
The list lives in `shared/constants.ts`.

"Fellows/Advisors/Board" was split into Fellows, Advisors, and Board. Contacts that still
carry the old type keep it, and it stays in the type filter until none are left. To move them,
filter Contacts by "Fellows/Advisors/Board", tick the people who belong in one group, and use
**Set type** in the bar that appears (editors and admins).

The workbook needs two matching changes in Excel, which the app cannot make:

1. **Dropdown on Master.** Select column D on Master, open **Data > Data Validation**, and in
   **Source** replace `Fellows/Advisors/Board` with `Fellows,Advisors,Board`.
2. **Category tabs.** The "Fellows & Advisors" tab lists rows whose type is exactly
   "Fellows/Advisors/Board", so it empties as people move. For one tab per group, right-click
   the tab, choose **Move or Copy**, tick **Create a copy**, and rename the copy (for example
   "Fellows"). On the copy, select column V, press **Ctrl+H**, and replace
   `"Fellows/Advisors/Board"` with `"Fellows"` (keep the quotation marks). Repeat for Advisors
   and Board. Do not rename the Master tab or its headers.

## Development

```bash
npm install
cp config.example.json public/config.json   # then fill it in
npm run dev        # http://localhost:5175 (add ?demo for sample data)
npm test           # workbook mapping, Microsoft Graph calls, card parsing
npm run typecheck
npm run build
```

Code layout:

- `src/lib/repo.ts`: maps workbook rows to contacts, touchpoints, connections, and users;
  finds rows by Unique ID before every write; detects conflicting edits.
- `src/lib/graph.ts`: the Microsoft Graph calls (sharing link, Excel ranges, sessions, retries).
- `src/lib/auth.ts`: Microsoft sign-in (MSAL).
- `src/lib/store.tsx`: loads the workbook and polls for changes.
- `src/pages/`: the screens. `shared/` holds the vocabulary and the business card parser.

## Limits worth knowing

- Updates from others appear within about 10 seconds, not instantly.
- Every save goes through Microsoft's Excel service and takes one to three seconds.
- The workbook's category tabs read Master rows 2 to 998. Past roughly 990 contacts, extend
  those formulas in Excel.
- The app needs a connection to load or save. Offline, it shows a "Can't reach OneDrive" notice.
