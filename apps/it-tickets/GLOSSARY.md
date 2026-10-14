# IT Tickets

A Slack bot that mimics a typical IT helpdesk bot. Instead of feeding a ticketing system, each Ticket goes to the Agent its Requester picks.

## Language

**Ticket**:
A request for IT help raised by a Requester, made up of a title, a description, a Category and an Urgency, and sent to one Agent.
_Avoid_: Issue, request, case, incident

**Ticket number**:
The sequential, human-friendly identity of a Ticket, such as `IT-0042`.
_Avoid_: Ticket ID, reference

**Status**:
Where a Ticket is in its lifecycle: Open, In progress or Resolved. A Ticket can go from Open to In progress, and from Open or In progress to Resolved. Nothing moves backwards.
_Avoid_: State, stage

**Take**:
The Agent's act of moving an Open Ticket to In progress.
_Avoid_: Claim, accept, assign

**Resolve**:
The Agent's act of moving a Ticket to Resolved, optionally with a Resolution note.
_Avoid_: Close, complete, finish

**Resolution note**:
An optional message from the Agent to the Requester explaining how a Ticket was resolved.
_Avoid_: Comment, reply

**Requester**:
The Slack user who raised a Ticket.
_Avoid_: Reporter, customer, submitter

**Agent**:
One of the Slack users, fixed by configuration, whom a Requester can pick to receive a Ticket. A Ticket's Agent never changes, and only they work on it.
_Avoid_: Assignee, admin, handler, configured user

**Confirmation**:
The private message the Requester receives when their Ticket is opened. Every later Status update for that Ticket is a threaded reply to it.
_Avoid_: Receipt, acknowledgement

**Ticket card**:
The private message a Ticket's Agent receives for it. It shows the Ticket's details and the actions available at its current Status, and it is kept up to date as the Status changes.
_Avoid_: Notification, alert

**Announcement**:
An optional post of a newly opened Ticket in #general, made when the Requester asks for one. It is never edited afterwards, but may get an Announcement follow-up in its thread.
_Avoid_: Broadcast, share

**Announcement follow-up**:
An optional threaded reply under a Ticket's Announcement, posted when the Agent Resolves it and asks for one. It says the Agent resolved the Ticket and includes the Resolution note, if any.
_Avoid_: Resolution reply, update

**Category**:
The kind of IT problem a Ticket concerns: Hardware, Software, Access, Network or Other.
_Avoid_: Type, topic

**Urgency**:
How pressing the Requester says the Ticket is: Low, Normal or High.
_Avoid_: Priority, severity
