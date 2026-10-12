# Weekly email sweep

Every Monday at 9:00 Eastern a Claude routine sends Ike a reminder. Claude has no standing
access to Outlook; each run gets access only for that run:

1. Connect **Microsoft 365** at https://claude.ai/customize/connectors.
2. Start a **new** Claude session (connectors are read when a session starts).
3. Paste the prompt below and send it.
4. When the Excel file arrives, open the tracker app, go to **Contacts → Import**, choose the
   file, review the ticked rows, and press **Save**. Nothing changes until you press Save.
5. Disconnect Microsoft 365 at https://claude.ai/customize/connectors.

## Prompt to paste

```
Run the FSI weekly email sweep. Microsoft 365 is connected for this run only.

This job is READ-ONLY for Microsoft 365: never send, reply, forward, draft, move, flag or delete email, and never upload, change or delete any SharePoint or OneDrive file. The only output is one Excel file sent to me.

WHO: Ike Harris (Isaac Harris), Executive Director, Frontier Security Institute (FSI), iharris@frontsec.org. Colleagues use @frontsec.org; @safe.ai addresses are CAIS/FSI-affiliated. My other addresses: iharris@fdd.org, isaac.harris@primesandc.com. Writing rules: no em dashes, no passive voice, plain factual wording.

TOOLS: load with ToolSearch "select:mcp__Microsoft_365__outlook_email_search,mcp__Microsoft_365__read_resource,mcp__Microsoft_365__sharepoint_search". If they are missing, stop and say Microsoft 365 is not connected to this session. Use subagents to read emails in parallel when there are more than about 15 people.

STEP 1. Read the tracker (read only): read_resource on file:///b!aMrut4ikiUKRYTjmhKRzRcrVOwfNnLJEtsLZx6mYqID6tOykC1TKQ5AvJxxHfngL/01C3PJM2VDF2SG7A4WHVFYBM2XAUHRNIWA (FSI_Relationship_Tracker_10.6.26_FINAL.xlsx on the FSIStakeholder-TrackerProgram site). If that fails, find it with sharepoint_search for "FSI_Relationship_Tracker" and use the copy whose webUrl contains "FSIStakeholder-TrackerProgram". Parse the "## Sheet: Master" section (tab-separated, header row) with Python into {id, name, organization, email, phone, title, address, office, lastContact}. Read the Touchpoints sheet too, to avoid repeats.

STEP 2. Collect email headers from the last 8 days: outlook_email_search with folderName "Inbox", afterDateTime = 8 days ago (ISO), limit 25, paging by offset until no nextOffset. Repeat for folderName "Sent Items".

STEP 3. Find external people. Skip frontsec.org and safe.ai; my own addresses; automated senders, newsletters and marketing; travel, hotels and airlines; FSI vendors (squirepb.com, fgsglobal.com, dodsecurity.com, selectpress.net, signalformstudio.com, frosch.com); personal and family addresses; generic mailboxes. Match the rest to the tracker by email, then by name (ignore titles, middle names, nicknames). NEW people count only if I wrote to them, they wrote to me directly, or they appear on 5+ emails; list the others on a Skipped sheet with the reason.

STEP 4. Read the emails (read_resource "mail:///messages/<id>", at most 4 per person). Record only what the emails support; never guess phones or titles; never record sensitive personal details (health, family, finances, home address, job searches).
 NEW people: name, title, organization, office/department, phone and office address from the signature, website, LinkedIn, relationship type (Fellows, Advisors, Board, AI Labs, Media, Policy/NatSec/Gov, Congress, Donors/Funders, Research/Institutional Partners, International Gov/Diplomatic, or blank), status ("Cultivating" if two-way or a meeting is set, else "Not yet engaged"), geo, international (Y/N), interest area, referred by, last contact date, next follow-up date only if an email names one, 2-5 tags, owner ("Ike Harris" unless only Aaron Frank, Susan Malandrino, Jeremy Pelter or Kali Wasenko works the relationship), notes starting "[Outlook sweep YYYY-MM-DD] " (who at FSI, the context, what was asked or agreed, open follow-ups), and connections to other people, especially people in the tracker.
 EXISTING contacts: an Updates row for each field the signature clearly changes (Title, Organization, Office / Department, Phone, Address, Website, LinkedIn) and for a specific new follow-up date (Next Follow-Up Date); one Touchpoints row per substantive thread (date of latest message, Type Email or Meeting, 1-2 factual sentences with commitments). Skip content-free calendar notices, auto-replies and touchpoints already logged.

STEP 5. Build FSI_Weekly_Email_Sweep_<today>.xlsx with Python openpyxl. Sheets in order, bold headers, every sheet present even if empty:
 "How to use": week covered, counts, "Open the tracker app, go to Contacts, then Import, choose this file, review the ticked rows, and press Save."
 "New contacts": Unique ID, Name, Organization, Relationship Type, Status, Relationship Owner, Email, Phone, Geo, Interest Area, International, Restricted, Referred By — Name, Referred By — Role, Date of Last Contact, Next Follow-Up Date, Date Added, Added By, Notes, Tags / Category, Title, LinkedIn, Website, Address, Updated At, Updated By, Other Types, Office / Department. IDs from 900001. Date Added = today. Added By = "Ike Harris (email sweep)". Dates as YYYY-MM-DD text.
 "Connections": ID, Contact A ID, Contact A, Contact B ID, Contact B, Connection, Note, Added By, Added At. File IDs for new people, tracker IDs and exact tracker names for existing ones. Connection: Introduced / connected, Knows personally, Worked together, Former colleagues, Met at an event, Family, or Other. IDs from 5001.
 "Updates": Unique ID, Name, Field, New value, Source (ID and name exactly as in the tracker; Field is the exact Master heading).
 "Touchpoints": Contact ID, Contact, Date, Type, Summary.
 "Skipped": Email, Reason.
 Re-open the file to check it loads.

STEP 6. Send me the file (SendUserFile, display "attach"), then a summary under 150 words: week covered, counts, the 3-5 most important items, any problems, and a 1-5 confidence score. If nothing is new, still send the file with empty sheets.
```
